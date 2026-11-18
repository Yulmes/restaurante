import { z } from 'zod';
import { localeSchema } from '../i18n/locales.ts';

/**
 * Contratos de la API pública del catálogo (M4, §4.2). La API ya resuelve el idioma: cada texto
 * llega en el idioma pedido o, si falta su traducción, en es-CR con `lang: 'es-CR'` para que la
 * web lo marque con `lang="es"` (§4.5).
 */
export const DIETARY_TAGS = ['SPICY', 'GLUTEN_FREE', 'VEGETARIAN'] as const;
export const dietaryTagSchema = z.enum(DIETARY_TAGS);
export type DietaryTag = z.infer<typeof dietaryTagSchema>;

/** Texto con el idioma en que realmente está escrito. */
export const localizedTextSchema = z.object({ text: z.string(), lang: localeSchema });
export type LocalizedText = z.infer<typeof localizedTextSchema>;

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const catalogImageSchema = z.object({
  /** Solo `STATIC` en M4 (fotos de la semilla, §9.4). */
  provider: z.enum(['STATIC', 'CLOUDINARY', 'R2']),
  storageKey: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: localizedTextSchema,
});
export type CatalogImage = z.infer<typeof catalogImageSchema>;

export const catalogOptionSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  priceDeltaMinor: z.number().int().nonnegative(),
  isDefault: z.boolean(),
  isAvailable: z.boolean(),
});

export const catalogOptionGroupSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().positive(),
  options: z.array(catalogOptionSchema),
});
export type CatalogOptionGroup = z.infer<typeof catalogOptionGroupSchema>;

export const catalogProductSchema = z.object({
  slug: slugSchema,
  /** Nombre original del plato (D2): nunca se traduce. */
  name: z.string(),
  /** Nombre en el idioma pedido solo si el original es descriptivo (§4.5). */
  translatedName: z.string().nullable(),
  description: localizedTextSchema,
  basePriceMinor: z.number().int().nonnegative(),
  tags: z.array(dietaryTagSchema),
  /** `false` = "Agotado hoy" (§3.6). */
  isAvailable: z.boolean(),
  image: catalogImageSchema.nullable(),
  optionGroups: z.array(catalogOptionGroupSchema),
});
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export const catalogCategorySchema = z.object({
  slug: slugSchema,
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  products: z.array(catalogProductSchema),
});
export type CatalogCategory = z.infer<typeof catalogCategorySchema>;

export const catalogResponseSchema = z.object({
  locale: localeSchema,
  currency: z.enum(['CRC', 'USD']),
  /** Versión del catálogo (§4.2, D10): cambia cuando cambia cualquier dato publicado. */
  version: z.string(),
  categories: z.array(catalogCategorySchema),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

export const catalogVersionResponseSchema = z.object({ version: z.string() });

/** Pizarra de pesca del día (§1.1, §3.6). Especie y puerto son nombres propios (sin traducción). */
export const catchBoardResponseSchema = z.object({
  board: z
    .object({
      /** Fecha local de Costa Rica, `YYYY-MM-DD`. Puede ser anterior a hoy si no se publicó otra. */
      date: z.iso.date(),
      isToday: z.boolean(),
      items: z.array(
        z.object({
          species: z.string(),
          port: z.string(),
          /** Hora local de llegada, `HH:mm`. */
          arrivedAt: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      ),
    })
    .nullable(),
});
export type CatchBoardResponse = z.infer<typeof catchBoardResponseSchema>;

/** Horario semanal (0 = domingo). Los minutos van desde la medianoche local. */
export const openingHoursResponseSchema = z.object({
  timezone: z.string(),
  days: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      opensMinutes: z.number().int().min(0).max(1440),
      closesMinutes: z.number().int().min(0).max(1440),
    }),
  ),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
});
export type OpeningHoursResponse = z.infer<typeof openingHoursResponseSchema>;
