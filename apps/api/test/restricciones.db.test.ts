/**
 * Restricciones del esquema (propuesta §6.3): únicos, CHECK, enumeraciones e índices.
 * Corre con el rol propietario para probar la base, no los permisos (ver auditoria.db.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  PG,
  anyProductId,
  anyZoneId,
  expectPgError,
  inRolledBackTx,
  insertCart,
  insertOrder,
  insertPayment,
  insertUser,
  ownerUrl,
  type Query,
} from './db.ts';

const ok = (fn: (q: Query) => Promise<unknown>) => inRolledBackTx(ownerUrl(), fn);
const fails = (
  fn: (q: Query) => Promise<unknown>,
  expected: { code: string; constraint?: string; message?: RegExp },
) => expectPgError(ownerUrl(), fn, expected);

describe('únicos', () => {
  it('el correo es único sin distinguir mayúsculas (índice lower(email))', async () => {
    await fails(
      async (q) => {
        await insertUser(q, 'Valeria@Marea.test');
        await insertUser(q, 'valeria@marea.test');
      },
      { code: PG.uniqueViolation, constraint: 'User_email_lower_key' },
    );
  });

  it('rechaza correos con espacios alrededor o sin @', async () => {
    await fails((q) => insertUser(q, ' valeria@marea.test'), {
      code: PG.checkViolation,
      constraint: 'User_email_check',
    });
    await fails((q) => insertUser(q, 'valeria.marea.test'), {
      code: PG.checkViolation,
      constraint: 'User_email_check',
    });
  });

  it('los slugs de plato y de categoría son únicos', async () => {
    await fails(
      async (q) => {
        const { rows } = await q(`SELECT "categoryId" FROM "Product" LIMIT 1`);
        await q(
          `INSERT INTO "Product" ("categoryId", "slug", "name", "description", "basePriceMinor", "updatedAt")
           VALUES ($1, 'ceviche-clasico', 'Otro', 'Otro', 100, now())`,
          [(rows[0] as { categoryId: string }).categoryId],
        );
      },
      { code: PG.uniqueViolation, constraint: 'Product_slug_key' },
    );
    await fails(
      (q) => q(`INSERT INTO "Category" ("slug", "name", "updatedAt") VALUES ('ceviches', 'Otra', now())`),
      { code: PG.uniqueViolation, constraint: 'Category_slug_key' },
    );
  });

  it('el código de pedido es único', async () => {
    await fails(
      async (q) => {
        const userId = await insertUser(q);
        await insertOrder(q, userId, { code: 'MB-0042' });
        await insertOrder(q, userId, { code: 'MB-0042' });
      },
      { code: PG.uniqueViolation, constraint: 'Order_code_key' },
    );
  });

  it('hay un solo pago por pedido', async () => {
    await fails(
      async (q) => {
        const orderId = await insertOrder(q, await insertUser(q));
        const amounts = { authorized: 890000, captured: 890000, refunded: 0 };
        await insertPayment(q, orderId, amounts);
        await insertPayment(q, orderId, amounts);
      },
      { code: PG.uniqueViolation, constraint: 'Payment_orderId_key' },
    );
  });

  it('la clave de idempotencia es única por (scope, key), no globalmente', async () => {
    const insertKey = (q: Query, userId: string, scope: string) =>
      q(
        `INSERT INTO "IdempotencyKey" ("scope", "key", "userId", "requestHash", "expiresAt")
         VALUES ($1, 'k-1', $2, 'h', now() + interval '1 day')`,
        [scope, userId],
      );
    await ok(async (q) => {
      const userId = await insertUser(q);
      await insertKey(q, userId, 'orders.create');
      await insertKey(q, userId, 'payments.authorize');
    });
    await fails(
      async (q) => {
        const userId = await insertUser(q);
        await insertKey(q, userId, 'orders.create');
        await insertKey(q, userId, 'orders.create');
      },
      { code: PG.uniqueViolation, constraint: 'IdempotencyKey_scope_key_key' },
    );
  });

  it('la clave de idempotencia de un reembolso es única', async () => {
    await fails(
      async (q) => {
        const userId = await insertUser(q);
        const paymentId = await insertPayment(q, await insertOrder(q, userId), {
          authorized: 890000,
          captured: 890000,
          refunded: 0,
        });
        for (let i = 0; i < 2; i++) {
          await q(
            `INSERT INTO "Refund" ("paymentId", "amountMinor", "reason", "idempotencyKey", "actorUserId")
             VALUES ($1, 100000, 'Plato agotado', 'refund-1', $2)`,
            [paymentId, userId],
          );
        }
      },
      { code: PG.uniqueViolation, constraint: 'Refund_idempotencyKey_key' },
    );
  });

  it('hay una sola traducción por entidad e idioma', async () => {
    await fails(
      async (q) =>
        q(
          `INSERT INTO "ProductTranslation" ("productId", "locale", "description") VALUES ($1, 'en', 'Duplicate')`,
          [await anyProductId(q)],
        ),
      { code: PG.uniqueViolation, constraint: 'ProductTranslation_productId_locale_key' },
    );
  });

  it('el hash del token de sesión es único', async () => {
    await fails(
      async (q) => {
        const userId = await insertUser(q);
        for (let i = 0; i < 2; i++) {
          await q(
            `INSERT INTO "Session" ("userId", "tokenHash", "csrfSecret", "idleExpiresAt", "absoluteExpiresAt")
             VALUES ($1, 'hash-1', 'csrf', now() + interval '7 days', now() + interval '30 days')`,
            [userId],
          );
        }
      },
      { code: PG.uniqueViolation, constraint: 'Session_tokenHash_key' },
    );
  });
});

describe('regla C5: hasta 20 unidades por línea interna', () => {
  const insertCartItem = async (q: Query, quantity: number) => {
    const cartId = await insertCart(q, await insertUser(q));
    await q(`INSERT INTO "CartItem" ("cartId", "productId", "quantity") VALUES ($1, $2, $3)`, [
      cartId,
      await anyProductId(q),
      quantity,
    ]);
  };

  it.each([1, 20])('CartItem acepta %i', async (quantity) => {
    await ok((q) => insertCartItem(q, quantity));
  });

  it.each([0, 21, -1])('CartItem rechaza %i', async (quantity) => {
    await fails((q) => insertCartItem(q, quantity), {
      code: PG.checkViolation,
      constraint: 'CartItem_quantity_check',
    });
  });

  it('un total de 25 se guarda como dos líneas internas (20 + 5) del mismo plato', async () => {
    await ok(async (q) => {
      const cartId = await insertCart(q, await insertUser(q));
      const productId = await anyProductId(q);
      for (const quantity of [20, 5]) {
        await q(`INSERT INTO "CartItem" ("cartId", "productId", "quantity") VALUES ($1, $2, $3)`, [
          cartId,
          productId,
          quantity,
        ]);
      }
      const { rows } = await q(`SELECT sum("quantity")::int AS total FROM "CartItem" WHERE "cartId" = $1`, [
        cartId,
      ]);
      expect(rows[0]).toEqual({ total: 25 });
    });
  });

  const insertOrderItem = async (q: Query, quantity: number, lineTotalMinor = 890000 * quantity) => {
    const orderId = await insertOrder(q, await insertUser(q));
    await q(
      `INSERT INTO "OrderItem" ("orderId", "orderLocale", "productName", "quantity", "unitPriceMinor", "lineTotalMinor")
       VALUES ($1, 'es-CR', 'Ceviche clásico de corvina', $2, 890000, $3)`,
      [orderId, quantity, lineTotalMinor],
    );
  };

  it.each([1, 20])('OrderItem acepta %i', async (quantity) => {
    await ok((q) => insertOrderItem(q, quantity));
  });

  it.each([0, 21])('OrderItem rechaza %i', async (quantity) => {
    await fails((q) => insertOrderItem(q, quantity), {
      code: PG.checkViolation,
      constraint: 'OrderItem_quantity_check',
    });
  });

  it('el total de la línea del pedido es (precio + opciones) × cantidad', async () => {
    await fails((q) => insertOrderItem(q, 2, 890000), {
      code: PG.checkViolation,
      constraint: 'OrderItem_amounts_check',
    });
  });
});

describe('montos y tasas', () => {
  it('rechaza precios y recargos negativos', async () => {
    await fails((q) => q(`UPDATE "Product" SET "basePriceMinor" = -1 WHERE "slug" = 'ceviche-clasico'`), {
      code: PG.checkViolation,
      constraint: 'Product_basePriceMinor_check',
    });
    await fails((q) => q(`UPDATE "ProductOption" SET "priceDeltaMinor" = -100`), {
      code: PG.checkViolation,
      constraint: 'ProductOption_priceDeltaMinor_check',
    });
    await fails((q) => q(`UPDATE "DeliveryZone" SET "feeMinor" = -100`), {
      code: PG.checkViolation,
      constraint: 'DeliveryZone_values_check',
    });
  });

  it('rechaza montos negativos en el pedido, pero admite un ajuste de redondeo negativo', async () => {
    await fails(async (q) => insertOrder(q, await insertUser(q), { subtotalMinor: -1 }), {
      code: PG.checkViolation,
      constraint: 'Order_amounts_check',
    });
    await ok(async (q) => insertOrder(q, await insertUser(q), { roundingAdjustmentMinor: -40 }));
  });

  it('un reembolso tiene monto positivo', async () => {
    await fails(
      async (q) => {
        const userId = await insertUser(q);
        const paymentId = await insertPayment(q, await insertOrder(q, userId), {
          authorized: 890000,
          captured: 890000,
          refunded: 0,
        });
        await q(
          `INSERT INTO "Refund" ("paymentId", "amountMinor", "reason", "idempotencyKey", "actorUserId")
           VALUES ($1, 0, 'x', 'r-0', $2)`,
          [paymentId, userId],
        );
      },
      { code: PG.checkViolation, constraint: 'Refund_amountMinor_check' },
    );
  });

  it.each([0, 1300, 10000])('una tasa acepta %i puntos básicos', async (rateBps) => {
    await ok((q) => q(`UPDATE "TaxRate" SET "rateBps" = $1 WHERE "key" = 'iva'`, [rateBps]));
  });

  it.each([-1, 10001])('una tasa rechaza %i puntos básicos', async (rateBps) => {
    await fails((q) => q(`UPDATE "TaxRate" SET "rateBps" = $1 WHERE "key" = 'iva'`, [rateBps]), {
      code: PG.checkViolation,
      constraint: 'TaxRate_rateBps_check',
    });
  });

  it('un impuesto aplica al menos a un tipo de entrega', async () => {
    await fails((q) => q(`UPDATE "TaxRate" SET "fulfillmentTypes" = '{}' WHERE "key" = 'iva'`), {
      code: PG.checkViolation,
      constraint: 'TaxRate_fulfillmentTypes_check',
    });
  });

  it('pago: reembolsado ≤ capturado ≤ autorizado', async () => {
    const tryAmounts =
      (amounts: { authorized: number; captured: number; refunded: number }) => async (q: Query) =>
        insertPayment(q, await insertOrder(q, await insertUser(q)), amounts);
    await ok(tryAmounts({ authorized: 890000, captured: 890000, refunded: 300000 }));
    await fails(tryAmounts({ authorized: 890000, captured: 890000, refunded: 900000 }), {
      code: PG.checkViolation,
      constraint: 'Payment_amounts_check',
    });
    await fails(tryAmounts({ authorized: 500000, captured: 890000, refunded: 0 }), {
      code: PG.checkViolation,
      constraint: 'Payment_amounts_check',
    });
  });

  it('procesador simulado: reembolsado ≤ capturado ≤ monto', async () => {
    await fails(
      (q) =>
        q(`INSERT INTO "MockGatewayTransaction" ("ref", "idempotencyKey", "amountMinor", "currency", "state", "scenario",
             "capturedMinor", "refundedMinor", "updatedAt")
           VALUES ('ref-1', 'k-1', 100, 'CRC', 'CAPTURED', 'APPROVED', 200, 0, now())`),
      { code: PG.checkViolation, constraint: 'MockGatewayTransaction_amounts_check' },
    );
  });
});

describe('reglas de negocio en el esquema', () => {
  it('los pedidos solo son de retiro o delivery: DINE_IN no existe (D4, C10)', async () => {
    await fails(async (q) => insertOrder(q, await insertUser(q), { fulfillmentType: 'DINE_IN' }), {
      code: PG.invalidTextRepresentation,
    });
  });

  it('DINE_IN sí es válido como ámbito de un impuesto (cargo de servicio inactivo)', async () => {
    await ok((q) => q(`UPDATE "TaxRate" SET "fulfillmentTypes" = '{DINE_IN}' WHERE "key" = 'servicio'`));
  });

  it('un delivery tiene zona y un retiro no', async () => {
    await fails(async (q) => insertOrder(q, await insertUser(q), { fulfillmentType: 'DELIVERY' }), {
      code: PG.checkViolation,
      constraint: 'Order_delivery_zone_check',
    });
    await fails(async (q) => insertOrder(q, await insertUser(q), { deliveryZoneId: await anyZoneId(q) }), {
      code: PG.checkViolation,
      constraint: 'Order_delivery_zone_check',
    });
    await ok(async (q) =>
      insertOrder(q, await insertUser(q), {
        fulfillmentType: 'DELIVERY',
        deliveryZoneId: await anyZoneId(q),
      }),
    );
  });

  it('la configuración tiene una sola fila', async () => {
    await fails(
      (q) =>
        q(`INSERT INTO "RestaurantSettings" ("id", "roundingIncrementMinor", "minOrderMinor", "turnstileGlobalThreshold",
             "turnstileWindowMinutes", "updatedAt") VALUES (2, 100, 0, 50, 60, now())`),
      { code: PG.checkViolation, constraint: 'RestaurantSettings_single_row_check' },
    );
  });

  it('el redondeo de la moneda es de al menos una unidad menor', async () => {
    await fails((q) => q(`UPDATE "RestaurantSettings" SET "roundingIncrementMinor" = 0`), {
      code: PG.checkViolation,
      constraint: 'RestaurantSettings_values_check',
    });
  });

  it('los horarios son válidos (día 0–6 y apertura antes del cierre)', async () => {
    await fails((q) => q(`UPDATE "OpeningHours" SET "dayOfWeek" = 7 WHERE "dayOfWeek" = 6`), {
      code: PG.checkViolation,
      constraint: 'OpeningHours_range_check',
    });
    await fails((q) => q(`UPDATE "OpeningHours" SET "closesMinutes" = "opensMinutes"`), {
      code: PG.checkViolation,
      constraint: 'OpeningHours_range_check',
    });
  });

  it('un grupo de opciones no puede exigir más de lo que permite', async () => {
    await fails((q) => q(`UPDATE "ProductOptionGroup" SET "minSelect" = 3, "maxSelect" = 2`), {
      code: PG.checkViolation,
      constraint: 'ProductOptionGroup_select_check',
    });
  });

  it('una promoción es porcentual o de monto fijo, con su valor, y termina después de empezar', async () => {
    const insertPromotion =
      (kind: string, percentBps: number | null, amountMinor: number | null, days = 7) =>
      (q: Query) =>
        q(
          `INSERT INTO "Promotion" ("code", "kind", "percentBps", "amountMinor", "startsAt", "endsAt")
         VALUES ('MAREA10', $1, $2, $3, now(), now() + make_interval(days => $4))`,
          [kind, percentBps, amountMinor, days],
        );
    await ok(insertPromotion('PERCENT', 1000, null));
    await ok(insertPromotion('FIXED_AMOUNT', null, 100000));
    await fails(insertPromotion('PERCENT', null, 100000), {
      code: PG.checkViolation,
      constraint: 'Promotion_kind_check',
    });
    await fails(insertPromotion('PERCENT', 1000, null, -1), {
      code: PG.checkViolation,
      constraint: 'Promotion_values_check',
    });
  });

  it('las traducciones no guardan es-CR: ese texto vive en la entidad principal (D2)', async () => {
    await fails(
      async (q) =>
        q(
          `INSERT INTO "ProductTranslation" ("productId", "locale", "description") VALUES ($1, 'es-CR', 'x')`,
          [await anyProductId(q)],
        ),
      { code: PG.checkViolation, constraint: 'ProductTranslation_locale_check' },
    );
  });

  it('una sesión no vence por inactividad después de su vencimiento absoluto', async () => {
    await fails(
      async (q) =>
        q(
          `INSERT INTO "Session" ("userId", "tokenHash", "csrfSecret", "idleExpiresAt", "absoluteExpiresAt")
           VALUES ($1, 'h', 'c', now() + interval '31 days', now() + interval '30 days')`,
          [await insertUser(q)],
        ),
      { code: PG.checkViolation, constraint: 'Session_expiry_check' },
    );
  });

  it('un plato con carritos no se puede borrar (sus líneas quedarían huérfanas)', async () => {
    await fails(
      async (q) => {
        const cartId = await insertCart(q, await insertUser(q));
        const productId = await anyProductId(q);
        await q(`INSERT INTO "CartItem" ("cartId", "productId", "quantity") VALUES ($1, $2, 1)`, [
          cartId,
          productId,
        ]);
        await q(`DELETE FROM "Product" WHERE "id" = $1`, [productId]);
      },
      { code: PG.foreignKeyViolation },
    );
  });
});

describe('índices de la propuesta §6.3', () => {
  // pg_indexes solo pone comillas a los nombres que las necesitan (por ejemplo, con mayúsculas).
  it.each([
    ['Order', '(status, "createdAt")'],
    ['Order', '("userId", "createdAt")'],
    ['Product', '("categoryId", "isActive")'],
    ['AuditLog', '("entityType", "entityId", "createdAt")'],
    ['RateLimitCounter', '("windowStart")'],
    ['EmailOutbox', '(status, "createdAt")'],
    ['User', '(lower(email))'],
  ])('existe el índice de %s %s', async (table, columns) => {
    await ok(async (q) => {
      const { rows } = await q(
        `SELECT "indexdef" FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
        [table],
      );
      const definitions = (rows as { indexdef: string }[]).map((row) => row.indexdef);
      expect(definitions.some((definition) => definition.endsWith(columns))).toBe(true);
    });
  });
});
