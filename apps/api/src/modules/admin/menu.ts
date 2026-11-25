import type {
  AdminCatchResponse,
  AdminCatchSaveRequest,
  AdminCategory,
  AdminCategoryCreateRequest,
  AdminCategoryUpdateRequest,
  AdminMenu,
  AdminOptionGroupUpdateRequest,
  AdminOptionUpdateRequest,
  AdminProduct,
  AdminProductCreateRequest,
  AdminProductUpdateRequest,
} from '@marea-baja/shared';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { recordAudit, type AuditActor } from '../audit/audit.ts';
import { addDays, localDateOf, localDateTime, localTimeOf } from './time.ts';

/**
 * Carta del admin (M8, §3.6, §8.6, D2):
 * - lista completa, con lo inactivo y las traducciones al inglés;
 * - platos y categorías: crear, editar, desactivar, precio y disponibilidad, con versión optimista
 *   por `updatedAt` (409 `RESOURCE_VERSION_CONFLICT`) y el slug fijo después de crearlo (§4.2);
 * - grupos y opciones: nombre, traducción, recargo y disponibilidad;
 * - pesca del día: guardar y publicar.
 *
 * Cada cambio escribe el AuditLog en la misma transacción (§8.6) y, al confirmarse, invalida la
 * versión del catálogo para que la web vuelva a pedir precios y disponibilidad (D10, R20).
 */
const productInclude = {
  translations: true,
  images: { orderBy: { sortOrder: 'asc' }, take: 1 },
  optionGroups: {
    orderBy: { sortOrder: 'asc' },
    include: {
      translations: true,
      options: { orderBy: { sortOrder: 'asc' }, include: { translations: true } },
    },
  },
} as const satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const enOf = <T extends { locale: string }>(rows: readonly T[]): T | undefined =>
  rows.find((row) => row.locale === 'en');

function toAdminProduct(row: ProductRow): AdminProduct {
  const en = enOf(row.translations);
  const image = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    basePriceMinor: row.basePriceMinor,
    tags: row.tags,
    isActive: row.isActive,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
    en: { name: en?.name ?? null, description: en?.description ?? null, altText: en?.altText ?? null },
    image: image ? { alt: image.alt } : null,
    optionGroups: row.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      enName: enOf(group.translations)?.name ?? null,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      isActive: group.isActive,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        enName: enOf(option.translations)?.name ?? null,
        priceDeltaMinor: option.priceDeltaMinor,
        isDefault: option.isDefault,
        isAvailable: option.isAvailable,
      })),
    })),
  };
}

/** Campos auditables de un plato (lista blanca `product`). */
function productAudit(row: ProductRow): Record<string, unknown> {
  const en = enOf(row.translations);
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    basePriceMinor: row.basePriceMinor,
    tags: row.tags,
    isActive: row.isActive,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
    enName: en?.name ?? null,
    enDescription: en?.description ?? null,
    enAltText: en?.altText ?? null,
    imageAlt: row.images[0]?.alt ?? null,
  };
}

/** Qué se registra en el AuditLog según lo que cambió (§8.6). */
function productActions(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const changed = (field: string) => JSON.stringify(before[field]) !== JSON.stringify(after[field]);
  const actions: string[] = [];
  if (changed('basePriceMinor')) actions.push('product.price_changed');
  if (changed('isAvailable')) actions.push('product.availability_changed');
  if (changed('isActive')) actions.push(after['isActive'] ? 'product.activated' : 'product.deactivated');
  const others = Object.keys(after).filter(
    (field) => !['basePriceMinor', 'isAvailable', 'isActive'].includes(field) && changed(field),
  );
  if (others.length > 0) actions.push('product.updated');
  return actions;
}

function categoryAudit(row: {
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  translations: { locale: string; name: string; description: string | null }[];
}): Record<string, unknown> {
  const en = enOf(row.translations);
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    enName: en?.name ?? null,
    enDescription: en?.description ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const conflict = () => new AppError(409, 'RESOURCE_VERSION_CONFLICT', 'The resource changed; reload it');
const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);

export interface MenuAdminDeps {
  db: PrismaClient;
  clock: Clock;
  /** Se llama después de cada cambio confirmado (invalida la versión del catálogo). */
  afterChange: () => void;
}

export class MenuAdminService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #afterChange: () => void;

  constructor(deps: MenuAdminDeps) {
    this.#db = deps.db;
    this.#clock = deps.clock;
    this.#afterChange = deps.afterChange;
  }

  async menu(): Promise<AdminMenu> {
    const [settings, categories] = await Promise.all([
      this.#db.restaurantSettings.findUniqueOrThrow({
        where: { id: 1 },
        select: { currency: true, roundingIncrementMinor: true },
      }),
      this.#db.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          translations: true,
          products: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: productInclude },
        },
      }),
    ]);
    return {
      currency: settings.currency,
      roundingIncrementMinor: settings.roundingIncrementMinor,
      categories: categories.map((category) => this.#toCategory(category)),
    };
  }

  #toCategory(
    category: Prisma.CategoryGetPayload<{ include: { translations: true } }> & { products?: ProductRow[] },
  ): AdminCategory {
    const en = enOf(category.translations);
    return {
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      updatedAt: category.updatedAt.toISOString(),
      en: { name: en?.name ?? null, description: en?.description ?? null },
      products: (category.products ?? []).map(toAdminProduct),
    };
  }

  async #assertPrice(tx: Prisma.TransactionClient, amounts: Record<string, number>): Promise<void> {
    const settings = await tx.restaurantSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { roundingIncrementMinor: true },
    });
    const fields: Record<string, string> = {};
    for (const [field, value] of Object.entries(amounts)) {
      if (value % settings.roundingIncrementMinor !== 0) fields[field] = 'increment';
    }
    if (Object.keys(fields).length > 0) {
      throw new AppError(400, 'PRICE_INCREMENT', 'Prices must be multiples of the rounding increment', {
        fields,
        details: { roundingIncrementMinor: settings.roundingIncrementMinor },
      });
    }
  }

  async #assertCategory(tx: Prisma.TransactionClient, categoryId: string): Promise<void> {
    const found = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!found)
      throw new AppError(400, 'VALIDATION_FAILED', 'Unknown category', { fields: { categoryId: 'invalid' } });
  }

  async #writeProductTexts(
    tx: Prisma.TransactionClient,
    productId: string,
    input: AdminProductCreateRequest | AdminProductUpdateRequest,
  ): Promise<void> {
    const en = {
      name: input.en.name ?? null,
      description: input.en.description,
      altText: input.en.altText ?? null,
    };
    await tx.productTranslation.upsert({
      where: { productId_locale: { productId, locale: 'en' } },
      create: { productId, locale: 'en', ...en },
      update: en,
    });
    // D-M8-2: solo el texto alternativo de la foto principal; sin foto, no se crea ninguna.
    const image = await tx.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'asc' } });
    if (image && input.imageAlt)
      await tx.productImage.update({ where: { id: image.id }, data: { alt: input.imageAlt } });
  }

  async createProduct(
    actor: AuditActor,
    input: AdminProductCreateRequest,
    requestId: string,
  ): Promise<AdminProduct> {
    try {
      const product = await this.#db.$transaction(async (tx) => {
        await this.#assertCategory(tx, input.categoryId);
        await this.#assertPrice(tx, { basePriceMinor: input.basePriceMinor });
        const created = await tx.product.create({
          data: {
            slug: input.slug,
            categoryId: input.categoryId,
            name: input.name,
            description: input.description,
            basePriceMinor: input.basePriceMinor,
            tags: input.tags,
            isActive: input.isActive,
            isAvailable: input.isAvailable,
            sortOrder: input.sortOrder,
            // §6.2: el plato nuevo queda asociado a todas las tasas, como la semilla. Si cada tasa
            // aplica lo deciden su `isActive`, su base y sus modalidades (motor de precios, M5).
            taxRates: {
              create: (await tx.taxRate.findMany({ select: { id: true } })).map((rate) => ({
                taxRateId: rate.id,
              })),
            },
          },
          select: { id: true },
        });
        await this.#writeProductTexts(tx, created.id, input);
        const row = await tx.product.findUniqueOrThrow({
          where: { id: created.id },
          include: productInclude,
        });
        await recordAudit(tx, {
          actor,
          action: 'product.created',
          entityType: 'product',
          entityId: row.id,
          after: productAudit(row),
          requestId,
        });
        return row;
      });
      this.#afterChange();
      return toAdminProduct(product);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(409, 'SLUG_TAKEN', 'Slug already in use', { fields: { slug: 'taken' } });
      throw error;
    }
  }

  async updateProduct(
    actor: AuditActor,
    productId: string,
    input: AdminProductUpdateRequest,
    requestId: string,
  ): Promise<AdminProduct> {
    const product = await this.#db.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id: productId }, include: productInclude });
      if (!before) throw notFound('Product');
      if (input.categoryId !== before.categoryId) await this.#assertCategory(tx, input.categoryId);
      if (input.basePriceMinor !== before.basePriceMinor) {
        await this.#assertPrice(tx, { basePriceMinor: input.basePriceMinor });
      }
      // Versión optimista: el UPDATE solo aplica si nadie lo cambió desde que se leyó (§7.1).
      const updated = await tx.product.updateMany({
        where: { id: productId, updatedAt: new Date(input.updatedAt) },
        data: {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          basePriceMinor: input.basePriceMinor,
          tags: input.tags,
          isActive: input.isActive,
          isAvailable: input.isAvailable,
          sortOrder: input.sortOrder,
          updatedAt: this.#clock.now(),
        },
      });
      if (updated.count === 0) throw conflict();
      await this.#writeProductTexts(tx, productId, input);
      const after = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
      const beforeAudit = productAudit(before);
      const afterAudit = productAudit(after);
      for (const action of productActions(beforeAudit, afterAudit)) {
        await recordAudit(tx, {
          actor,
          action,
          entityType: 'product',
          entityId: productId,
          before: beforeAudit,
          after: afterAudit,
          requestId,
        });
      }
      return after;
    });
    this.#afterChange();
    return toAdminProduct(product);
  }

  async createCategory(actor: AuditActor, input: AdminCategoryCreateRequest, requestId: string) {
    try {
      const category = await this.#db.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
            translations: {
              create: { locale: 'en', name: input.en.name, description: input.en.description ?? null },
            },
          },
          include: { translations: true },
        });
        await recordAudit(tx, {
          actor,
          action: 'category.created',
          entityType: 'category',
          entityId: created.id,
          after: categoryAudit(created),
          requestId,
        });
        return created;
      });
      this.#afterChange();
      const { products: _products, ...rest } = this.#toCategory(category);
      return rest;
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError(409, 'SLUG_TAKEN', 'Slug already in use', { fields: { slug: 'taken' } });
      throw error;
    }
  }

  async updateCategory(
    actor: AuditActor,
    categoryId: string,
    input: AdminCategoryUpdateRequest,
    requestId: string,
  ) {
    const category = await this.#db.$transaction(async (tx) => {
      const before = await tx.category.findUnique({
        where: { id: categoryId },
        include: { translations: true },
      });
      if (!before) throw notFound('Category');
      const updated = await tx.category.updateMany({
        where: { id: categoryId, updatedAt: new Date(input.updatedAt) },
        data: {
          name: input.name,
          description: input.description ?? null,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
          updatedAt: this.#clock.now(),
        },
      });
      if (updated.count === 0) throw conflict();
      const en = { name: input.en.name, description: input.en.description ?? null };
      await tx.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId, locale: 'en' } },
        create: { categoryId, locale: 'en', ...en },
        update: en,
      });
      const after = await tx.category.findUniqueOrThrow({
        where: { id: categoryId },
        include: { translations: true },
      });
      const action =
        before.isActive !== after.isActive
          ? after.isActive
            ? 'category.activated'
            : 'category.deactivated'
          : 'category.updated';
      await recordAudit(tx, {
        actor,
        action,
        entityType: 'category',
        entityId: categoryId,
        before: categoryAudit(before),
        after: categoryAudit(after),
        requestId,
      });
      return after;
    });
    this.#afterChange();
    const { products: _products, ...rest } = this.#toCategory(category);
    return rest;
  }

  async updateOptionGroup(
    actor: AuditActor,
    groupId: string,
    input: AdminOptionGroupUpdateRequest,
    requestId: string,
  ): Promise<AdminProduct> {
    const productId = await this.#db.$transaction(async (tx) => {
      const before = await tx.productOptionGroup.findUnique({
        where: { id: groupId },
        include: { translations: true },
      });
      if (!before) throw notFound('Option group');
      await tx.productOptionGroup.update({
        where: { id: groupId },
        data: { name: input.name, isActive: input.isActive },
      });
      await this.#writeTranslatedName(tx, 'group', groupId, input.enName ?? null);
      await tx.product.update({ where: { id: before.productId }, data: { updatedAt: this.#clock.now() } });
      await recordAudit(tx, {
        actor,
        action: 'option_group.updated',
        entityType: 'optionGroup',
        entityId: groupId,
        before: {
          productId: before.productId,
          name: before.name,
          enName: enOf(before.translations)?.name ?? null,
          isActive: before.isActive,
        },
        after: {
          productId: before.productId,
          name: input.name,
          enName: input.enName ?? null,
          isActive: input.isActive,
        },
        requestId,
      });
      return before.productId;
    });
    this.#afterChange();
    return this.#product(productId);
  }

  async updateOption(
    actor: AuditActor,
    optionId: string,
    input: AdminOptionUpdateRequest,
    requestId: string,
  ): Promise<AdminProduct> {
    const productId = await this.#db.$transaction(async (tx) => {
      const before = await tx.productOption.findUnique({
        where: { id: optionId },
        include: { translations: true, group: { select: { productId: true } } },
      });
      if (!before) throw notFound('Option');
      if (input.priceDeltaMinor !== before.priceDeltaMinor) {
        await this.#assertPrice(tx, { priceDeltaMinor: input.priceDeltaMinor });
      }
      await tx.productOption.update({
        where: { id: optionId },
        data: { name: input.name, priceDeltaMinor: input.priceDeltaMinor, isAvailable: input.isAvailable },
      });
      await this.#writeTranslatedName(tx, 'option', optionId, input.enName ?? null);
      await tx.product.update({
        where: { id: before.group.productId },
        data: { updatedAt: this.#clock.now() },
      });
      const action =
        before.priceDeltaMinor !== input.priceDeltaMinor
          ? 'option.price_changed'
          : before.isAvailable !== input.isAvailable
            ? 'option.availability_changed'
            : 'option.updated';
      await recordAudit(tx, {
        actor,
        action,
        entityType: 'option',
        entityId: optionId,
        before: {
          groupId: before.groupId,
          name: before.name,
          enName: enOf(before.translations)?.name ?? null,
          priceDeltaMinor: before.priceDeltaMinor,
          isAvailable: before.isAvailable,
        },
        after: {
          groupId: before.groupId,
          name: input.name,
          enName: input.enName ?? null,
          priceDeltaMinor: input.priceDeltaMinor,
          isAvailable: input.isAvailable,
        },
        requestId,
      });
      return before.group.productId;
    });
    this.#afterChange();
    return this.#product(productId);
  }

  /** Sin traducción, la web muestra el nombre en es-CR marcado con su idioma (§4.5). */
  async #writeTranslatedName(
    tx: Prisma.TransactionClient,
    kind: 'group' | 'option',
    id: string,
    name: string | null,
  ): Promise<void> {
    if (kind === 'group') {
      if (name === null) await tx.optionGroupTranslation.deleteMany({ where: { groupId: id, locale: 'en' } });
      else
        await tx.optionGroupTranslation.upsert({
          where: { groupId_locale: { groupId: id, locale: 'en' } },
          create: { groupId: id, locale: 'en', name },
          update: { name },
        });
      return;
    }
    if (name === null) await tx.optionTranslation.deleteMany({ where: { optionId: id, locale: 'en' } });
    else
      await tx.optionTranslation.upsert({
        where: { optionId_locale: { optionId: id, locale: 'en' } },
        create: { optionId: id, locale: 'en', name },
        update: { name },
      });
  }

  async #product(productId: string): Promise<AdminProduct> {
    return toAdminProduct(
      await this.#db.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude }),
    );
  }

  // ─── Pesca del día ─────────────────────────────────────────────────────────

  async #timezone(db: Prisma.TransactionClient | PrismaClient): Promise<string> {
    const settings = await db.restaurantSettings.findUnique({ where: { id: 1 }, select: { timezone: true } });
    return settings?.timezone ?? 'America/Costa_Rica';
  }

  async catchBoards(): Promise<AdminCatchResponse> {
    const timezone = await this.#timezone(this.#db);
    const today = localDateOf(this.#clock.now(), timezone);
    const boards = await this.#db.catchOfTheDay.findMany({
      orderBy: { date: 'desc' },
      take: 7,
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return {
      today,
      timezone,
      boards: boards.map((board) => ({
        date: board.date.toISOString().slice(0, 10),
        publishedAt: board.publishedAt?.toISOString() ?? null,
        items: board.items.map((item) => ({
          species: item.species,
          port: item.port,
          arrivedAt: localTimeOf(item.arrivedAt, timezone),
        })),
      })),
    };
  }

  /**
   * Guarda la pizarra de un día (hoy o mañana: no se reescribe el pasado) y, si se pide, la
   * publica. Despublicar no está en el alcance: una pizarra publicada se corrige guardándola de nuevo.
   */
  async saveCatch(
    actor: AuditActor,
    input: AdminCatchSaveRequest,
    requestId: string,
  ): Promise<AdminCatchResponse> {
    await this.#db.$transaction(async (tx) => {
      const timezone = await this.#timezone(tx);
      const today = localDateOf(this.#clock.now(), timezone);
      if (input.date !== today && input.date !== addDays(today, 1)) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Only today or tomorrow', {
          fields: { date: 'invalid' },
        });
      }
      const date = new Date(`${input.date}T00:00:00.000Z`);
      const existing = await tx.catchOfTheDay.findUnique({ where: { date }, include: { items: true } });
      const board = existing
        ? await tx.catchOfTheDay.update({
            where: { id: existing.id },
            data: { publishedAt: input.publish ? this.#clock.now() : existing.publishedAt },
          })
        : await tx.catchOfTheDay.create({
            data: { date, publishedAt: input.publish ? this.#clock.now() : null },
          });
      await tx.catchItem.deleteMany({ where: { catchId: board.id } });
      await tx.catchItem.createMany({
        data: input.items.map((item, index) => {
          const [h, m] = item.arrivedAt.split(':').map(Number);
          return {
            catchId: board.id,
            species: item.species,
            port: item.port,
            arrivedAt: localDateTime(input.date, timezone, (h ?? 0) * 60 + (m ?? 0)),
            sortOrder: index,
          };
        }),
      });
      const summary = (items: readonly { species: string; port: string }[], published: boolean) => ({
        date: input.date,
        published,
        species: items.map((item) => item.species),
        ports: [...new Set(items.map((item) => item.port))],
        itemCount: items.length,
      });
      await recordAudit(tx, {
        actor,
        action: input.publish ? 'catch.published' : 'catch.saved',
        entityType: 'catch',
        entityId: board.id,
        before: existing ? summary(existing.items, existing.publishedAt !== null) : null,
        after: summary(input.items, input.publish || existing?.publishedAt != null),
        requestId,
      });
    });
    return this.catchBoards();
  }
}
