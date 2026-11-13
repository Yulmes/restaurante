-- M2 · Lo que Prisma no expresa en el esquema: CHECK, índice funcional, trigger del AuditLog y
-- permisos del rol de la aplicación. Diseño: propuesta §6.2, §6.3, §7.5 (regla C5) y §8.6.
-- Cada restricción tiene un test en apps/api/test/restricciones.db.test.ts.

-- ─── Correo único sin distinguir mayúsculas (§6.3) ─────────────────────────
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
ALTER TABLE "User" ADD CONSTRAINT "User_email_check" CHECK ("email" = btrim("email") AND position('@' IN "email") > 1);

-- ─── Textos traducidos: el es-CR vive en la entidad principal (§4.5, §6.1) ──
ALTER TABLE "CategoryTranslation" ADD CONSTRAINT "CategoryTranslation_locale_check" CHECK ("locale" <> 'es-CR');
ALTER TABLE "ProductTranslation" ADD CONSTRAINT "ProductTranslation_locale_check" CHECK ("locale" <> 'es-CR');
ALTER TABLE "OptionGroupTranslation" ADD CONSTRAINT "OptionGroupTranslation_locale_check" CHECK ("locale" <> 'es-CR');
ALTER TABLE "OptionTranslation" ADD CONSTRAINT "OptionTranslation_locale_check" CHECK ("locale" <> 'es-CR');

-- ─── Catálogo ───────────────────────────────────────────────────────────────
ALTER TABLE "Product" ADD CONSTRAINT "Product_basePriceMinor_check" CHECK ("basePriceMinor" >= 0);
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_priceDeltaMinor_check" CHECK ("priceDeltaMinor" >= 0);
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_select_check"
  CHECK ("minSelect" >= 0 AND "maxSelect" >= 1 AND "maxSelect" >= "minSelect");
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_size_check" CHECK ("width" > 0 AND "height" > 0);

-- ─── Configuración, impuestos, zonas y promociones (§6.2, D5) ──────────────
ALTER TABLE "RestaurantSettings" ADD CONSTRAINT "RestaurantSettings_single_row_check" CHECK ("id" = 1);
ALTER TABLE "RestaurantSettings" ADD CONSTRAINT "RestaurantSettings_values_check" CHECK (
  "roundingIncrementMinor" >= 1
  AND "minOrderMinor" >= 0
  AND "turnstileGlobalThreshold" >= 1
  AND "turnstileWindowMinutes" >= 1
  AND "timezone" <> ''
);
ALTER TABLE "OpeningHours" ADD CONSTRAINT "OpeningHours_range_check" CHECK (
  "dayOfWeek" BETWEEN 0 AND 6
  AND "opensMinutes" >= 0
  AND "closesMinutes" <= 1440
  AND "opensMinutes" < "closesMinutes"
);
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_rateBps_check" CHECK ("rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_fulfillmentTypes_check" CHECK (cardinality("fulfillmentTypes") >= 1);
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_values_check" CHECK ("feeMinor" >= 0 AND "etaMinutes" > 0);
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_kind_check" CHECK (
  ("kind" = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "amountMinor" IS NULL)
  OR ("kind" = 'FIXED_AMOUNT' AND "amountMinor" > 0 AND "percentBps" IS NULL)
);
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_values_check" CHECK ("minSubtotalMinor" >= 0 AND "endsAt" > "startsAt");

-- ─── Carrito: hasta 20 unidades por línea interna (regla C5, §6.3, §7.5) ────
-- El total que gestiona el cliente no tiene tope; la API lo reparte en líneas de hasta 20.
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 20);

-- ─── Pedidos (§6.1, §6.2) ───────────────────────────────────────────────────
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_check" CHECK (
  "subtotalMinor" >= 0
  AND "discountMinor" >= 0
  AND "deliveryFeeMinor" >= 0
  AND "taxTotalMinor" >= 0
  AND "totalMinor" >= 0
  AND "currencyMinorUnits" BETWEEN 0 AND 3
);
-- Un pedido de delivery tiene zona; uno de retiro, no.
ALTER TABLE "Order" ADD CONSTRAINT "Order_delivery_zone_check" CHECK (
  ("fulfillmentType" = 'DELIVERY') = ("deliveryZoneId" IS NOT NULL)
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 20);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_check" CHECK (
  "unitPriceMinor" >= 0
  AND "optionsTotalMinor" >= 0
  AND "lineTotalMinor" = ("unitPriceMinor" + "optionsTotalMinor") * "quantity"
);
ALTER TABLE "OrderItemOption" ADD CONSTRAINT "OrderItemOption_priceDeltaMinor_check" CHECK ("priceDeltaMinor" >= 0);
ALTER TABLE "OrderTaxLine" ADD CONSTRAINT "OrderTaxLine_values_check" CHECK (
  "rateBps" BETWEEN 0 AND 10000 AND "taxableBaseMinor" >= 0 AND "taxMinor" >= 0
);

-- ─── Pagos (§6.3, §7.2) ─────────────────────────────────────────────────────
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amounts_check" CHECK (
  "amountRefundedMinor" >= 0
  AND "amountRefundedMinor" <= "amountCapturedMinor"
  AND "amountCapturedMinor" <= "amountAuthorizedMinor"
);
ALTER TABLE "PaymentOperation" ADD CONSTRAINT "PaymentOperation_values_check" CHECK ("amountMinor" >= 0 AND "attempts" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amountMinor_check" CHECK ("amountMinor" > 0);
ALTER TABLE "MockGatewayTransaction" ADD CONSTRAINT "MockGatewayTransaction_amounts_check" CHECK (
  "amountMinor" >= 0
  AND "refundedMinor" >= 0
  AND "refundedMinor" <= "capturedMinor"
  AND "capturedMinor" <= "amountMinor"
);

-- ─── Sesiones, límites y correo (§8) ────────────────────────────────────────
ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_check" CHECK ("idleExpiresAt" <= "absoluteExpiresAt");
ALTER TABLE "RateLimitCounter" ADD CONSTRAINT "RateLimitCounter_count_check" CHECK ("count" >= 1);
ALTER TABLE "LoginLock" ADD CONSTRAINT "LoginLock_level_check" CHECK ("level" >= 1);
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_values_check" CHECK ("scope" <> '' AND "key" <> '');

-- ─── AuditLog de solo inserción (§8.6, punto 3) ────────────────────────────
-- El trigger rechaza UPDATE, DELETE y TRUNCATE aunque el rol tenga permisos.
-- Las purgas de retención las hace el propietario con un script de mantenimiento documentado.
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es de solo inserción: % no está permitido', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "AuditLog_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();

-- ─── Permisos del rol de la aplicación (§8.6, punto 2; ADR 0003) ───────────
-- `marea_app_rw` es un rol de grupo sin login. El usuario con login de la API (local:
-- `marea_app`) se crea fuera de las migraciones, con su contraseña, y se agrega a este grupo
-- (`npm run db:app-role` en local y CI; DEPLOYMENT.md en M10).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marea_app_rw') THEN
    CREATE ROLE "marea_app_rw" NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO "marea_app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "marea_app_rw";

-- El AuditLog solo admite lectura e inserción.
REVOKE ALL ON "AuditLog" FROM "marea_app_rw";
GRANT SELECT, INSERT ON "AuditLog" TO "marea_app_rw";

-- La aplicación no ve ni toca el historial de migraciones.
REVOKE ALL ON "_prisma_migrations" FROM "marea_app_rw";

-- Las tablas que creen las migraciones futuras reciben los mismos permisos de datos.
-- (No incluye el AuditLog, que ya existe con sus permisos restringidos.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "marea_app_rw";
