/**
 * Datos de muestra SOLO para la página interna /_design. No son la carta real
 * (la carta y sus datos vienen de la base de datos desde M2/M4).
 * Los nombres de los platos son originales y no se traducen (D2).
 */
export const SAMPLE_DISHES = [
  {
    key: 'clasico',
    name: 'Ceviche clásico de corvina',
    priceMinor: 890_000,
    tags: ['catchOfTheDay', 'spicy'],
  },
  { key: 'nikkei', name: 'Ceviche nikkei', priceMinor: 960_000, tags: ['glutenFreeOnRequest'] },
  {
    key: 'tiradito',
    name: 'Tiradito nikkei de pulpo del Golfo de Nicoya con leche de tigre de ají amarillo',
    priceMinor: 12_500_000,
    tags: ['catchOfTheDay'],
  },
  {
    key: 'olivo',
    name: 'Ceviche de pulpo al olivo',
    priceMinor: 1_020_000,
    tags: ['soldOutToday'],
    soldOut: true,
  },
] as const;

/** Validación V3: caracteres que deben verse con las tipografías aprobadas (y ₡ con su respaldo). */
export const GLYPH_SAMPLES = ['áéíóú ÁÉÍÓÚ ñÑ üÜ', '¿ ¡ « » “ ” ‘ ’ — – · …', '₡ $ 0123456789 , .'] as const;

/** Precio más largo previsto para la validación de legibilidad en el celular (§3.10). */
export const LONGEST_PRICE_MINOR = 12_500_000;
