/**
 * Datos semilla de Marea Baja (M2). Solo datos: la escritura está en `seed.ts`.
 *
 * - La carta se armó a partir de las 19 fotos aprobadas (riesgo R7: la carta se ajusta a las fotos,
 *   no al revés). Cada plato con foto apunta a su archivo de `apps/web/photos/source/`.
 * - Precios en CRC, en céntimos (unidad menor ISO 4217): ₡8 900 = 890000. IVA incluido (D5).
 * - Textos en es-CR (fuente) y en (D2). Los nombres originales de los platos no se traducen; solo
 *   llevan nombre en inglés los que son descriptivos (§4.5).
 * - Valores fiscales semilla aprobados (D5): IVA 13 % incluido y cargo de servicio 10 % inactivo,
 *   solo para consumo en el local (C10). Son parámetros de demostración, no asesoría tributaria.
 * - Sin usuarios ni contraseñas: las cuentas se crean en M3.
 */

/** Colones enteros → céntimos. */
export const crc = (colones: number): number => colones * 100;

export type SeedTag = 'SPICY' | 'GLUTEN_FREE' | 'VEGETARIAN';

export interface SeedText {
  readonly es: string;
  readonly en: string;
}

export interface SeedOption {
  readonly name: SeedText;
  readonly priceDeltaMinor: number;
  readonly isDefault?: boolean;
}

export interface SeedOptionGroup {
  readonly name: SeedText;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly SeedOption[];
}

export interface SeedImage {
  /** Nombre del archivo en `apps/web/photos/source/`, sin extensión. */
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  readonly alt: SeedText;
}

export interface SeedProduct {
  readonly slug: string;
  /** Nombre original del plato (no se traduce). */
  readonly name: string;
  /** Solo para nombres descriptivos que conviene traducir. */
  readonly nameEn?: string;
  readonly description: SeedText;
  readonly basePriceMinor: number;
  readonly tags: readonly SeedTag[];
  readonly isAvailable?: boolean;
  readonly image?: SeedImage;
  readonly optionGroups: readonly SeedOptionGroup[];
}

export interface SeedCategory {
  readonly slug: string;
  readonly name: SeedText;
  readonly description: SeedText;
  readonly products: readonly SeedProduct[];
}

// ─── Grupos de opciones reutilizados ────────────────────────────────────────

const PUNTO_DEL_PICANTE: SeedOptionGroup = {
  name: { es: 'Punto del picante', en: 'Heat level' },
  minSelect: 1,
  maxSelect: 1,
  options: [
    { name: { es: 'Suave', en: 'Mild' }, priceDeltaMinor: 0, isDefault: true },
    { name: { es: 'Con ají limo', en: 'With ají limo' }, priceDeltaMinor: 0 },
    { name: { es: 'Rocoto, para valientes', en: 'Rocoto, for the brave' }, priceDeltaMinor: crc(600) },
  ],
};

const EXTRAS_CEVICHE: SeedOptionGroup = {
  name: { es: 'Extras', en: 'Extras' },
  minSelect: 0,
  maxSelect: 2,
  options: [
    { name: { es: 'Palta', en: 'Avocado' }, priceDeltaMinor: crc(900) },
    { name: { es: 'Camote glaseado', en: 'Glazed sweet potato' }, priceDeltaMinor: crc(500) },
    { name: { es: 'Salsa chalaca', en: 'Salsa chalaca' }, priceDeltaMinor: crc(700) },
  ],
};

const SALSAS_MAKI: SeedOptionGroup = {
  name: { es: 'Salsa extra', en: 'Extra sauce' },
  minSelect: 0,
  maxSelect: 2,
  options: [
    { name: { es: 'Acevichada', en: 'Acevichada (ceviche mayo)' }, priceDeltaMinor: crc(400) },
    { name: { es: 'Anticuchera', en: 'Anticuchera (ají panca)' }, priceDeltaMinor: crc(400) },
  ],
};

// ─── Carta ──────────────────────────────────────────────────────────────────

export const CATEGORIES: readonly SeedCategory[] = [
  {
    slug: 'ceviches',
    name: { es: 'Ceviches', en: 'Ceviches' },
    description: {
      es: 'Pescado cortado al momento del pedido y curado en leche de tigre.',
      en: 'Fish cut when you order and cured in leche de tigre.',
    },
    products: [
      {
        slug: 'ceviche-clasico',
        name: 'Ceviche clásico de corvina',
        description: {
          es: 'Corvina de Puntarenas en leche de tigre de limón mesino, con camote glaseado y choclo tostado.',
          en: 'Puntarenas corvina in Mesino lime leche de tigre, with glazed sweet potato and toasted corn.',
        },
        basePriceMinor: crc(8900),
        tags: [],
        image: {
          storageKey: '02-ceviche-clasico',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Ceviche de pescado blanco con cebolla morada en un cuenco, con luz natural.',
            en: 'White fish ceviche with red onion in a bowl, in natural light.',
          },
        },
        optionGroups: [PUNTO_DEL_PICANTE, EXTRAS_CEVICHE],
      },
      {
        slug: 'ceviche-nikkei',
        name: 'Ceviche nikkei',
        description: {
          es: 'Atún en leche de tigre de soya y yuzu, pepino, sésamo negro y nori.',
          en: 'Tuna in soy and yuzu leche de tigre, cucumber, black sesame and nori.',
        },
        basePriceMinor: crc(9600),
        tags: [],
        image: {
          storageKey: '01-ceviche-cuenco-piedra',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Ceviche en un cuenco de piedra sobre madera oscura, con fondo negro.',
            en: 'Ceviche in a stone bowl on dark wood, against a black background.',
          },
        },
        optionGroups: [PUNTO_DEL_PICANTE, EXTRAS_CEVICHE],
      },
      {
        slug: 'ceviche-mixto',
        name: 'Ceviche mixto con chicharrón de calamar',
        description: {
          es: 'Pescado del día, pulpo y langostino en leche de tigre clásica, con chicharrón de calamar, cancha y camote.',
          en: 'Catch of the day, octopus and prawns in classic leche de tigre, with crispy fried squid, cancha (toasted corn kernels) and sweet potato.',
        },
        basePriceMinor: crc(10400),
        tags: [],
        image: {
          storageKey: '05-ceviche-peruano-calamar',
          width: 1602,
          height: 2400,
          alt: {
            es: 'Ceviche con calamar frito, camote, choclo y cancha en un plato de cerámica gris.',
            en: 'Ceviche with fried squid, sweet potato, corn and cancha on a grey ceramic plate.',
          },
        },
        optionGroups: [PUNTO_DEL_PICANTE, EXTRAS_CEVICHE],
      },
      {
        slug: 'ceviche-de-pargo',
        name: 'Ceviche de pargo',
        description: {
          es: 'Pargo rojo del Golfo de Nicoya con cebolla morada, culantro y leche de tigre de ají amarillo.',
          en: 'Red snapper from the Gulf of Nicoya with red onion, cilantro and ají amarillo leche de tigre.',
        },
        basePriceMinor: crc(8400),
        tags: [],
        image: {
          storageKey: '03-ceviche-cebolla-morada',
          width: 2400,
          height: 1600,
          alt: {
            es: 'Ceviche con cebolla morada en un cuenco blanco, visto de costado.',
            en: 'Ceviche with red onion in a white bowl, seen from the side.',
          },
        },
        optionGroups: [PUNTO_DEL_PICANTE, EXTRAS_CEVICHE],
      },
    ],
  },
  {
    slug: 'tiraditos',
    name: { es: 'Tiraditos', en: 'Tiraditos' },
    description: {
      es: 'Láminas finas de pescado con leches de tigre de la casa.',
      en: 'Thin slices of fish with our own leches de tigre.',
    },
    products: [
      {
        slug: 'tiradito-de-pescado-blanco',
        name: 'Tiradito de pescado blanco',
        description: {
          es: 'Láminas de corvina con leche de tigre de limón, aceite de oliva, sal de mar y brotes.',
          en: 'Thinly sliced corvina with lime leche de tigre, olive oil, sea salt and sprouts.',
        },
        basePriceMinor: crc(8700),
        tags: [],
        image: {
          storageKey: '07-tiradito-pescado-blanco',
          width: 1800,
          height: 2400,
          alt: {
            es: 'Láminas finas de pescado blanco sobre un plato blanco y una superficie de piedra gris, vistas desde arriba.',
            en: 'Thin slices of white fish on a white plate and grey stone, seen from above.',
          },
        },
        optionGroups: [PUNTO_DEL_PICANTE],
      },
      {
        slug: 'tiradito-nikkei',
        name: 'Tiradito nikkei de atún y salmón',
        description: {
          es: 'Atún y salmón en leche de tigre de ají amarillo, aceite de sésamo tostado y cebollín.',
          en: 'Tuna and salmon in ají amarillo leche de tigre, toasted sesame oil and chives.',
        },
        basePriceMinor: crc(9900),
        tags: [],
        image: {
          storageKey: '08-tiradito-aji-amarillo',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Láminas de atún y salmón en salsa naranja sobre un plato de piedra.',
            en: 'Slices of tuna and salmon in an orange sauce on a stone plate.',
          },
        },
        optionGroups: [PUNTO_DEL_PICANTE],
      },
      {
        slug: 'tiradito-al-rocoto',
        name: 'Tiradito al rocoto',
        description: {
          es: 'Pescado del día con crema de rocoto, limón y maíz morado tostado. Picante de verdad.',
          en: 'Catch of the day with rocoto cream, lime and toasted purple corn. Properly spicy.',
        },
        basePriceMinor: crc(9200),
        tags: ['SPICY'],
        image: {
          storageKey: '09-tiraditos-barra',
          width: 1800,
          height: 2400,
          alt: {
            es: 'Dos platos de tiradito en cerámica azul sobre piedra, con luz baja de barra.',
            en: 'Two tiradito plates in blue ceramic on stone, in low bar lighting.',
          },
        },
        optionGroups: [],
      },
    ],
  },
  {
    slug: 'crudos',
    name: { es: 'Crudos', en: 'Raw dishes' },
    description: {
      es: 'Mariscos y pescados crudos, cortados y aliñados al momento.',
      en: 'Raw seafood and fish, cut and dressed to order.',
    },
    products: [
      {
        slug: 'tartara-de-atun',
        name: 'Tártara de atún nikkei',
        description: {
          es: 'Atún picado a cuchillo con palta, rabanito, jalapeño y ponzu.',
          en: 'Hand-chopped tuna with avocado, radish, jalapeño and ponzu.',
        },
        basePriceMinor: crc(9800),
        tags: ['SPICY'],
        image: {
          storageKey: '06-tartara-atun-nikkei',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Torre de tártara de atún con rabanito y jalapeño.',
            en: 'Tuna tartare tower with radish and jalapeño.',
          },
        },
        optionGroups: [],
      },
      {
        slug: 'langostinos-al-aji-amarillo',
        name: 'Langostinos crudos al ají amarillo',
        nameEn: 'Raw prawns with ají amarillo',
        description: {
          es: 'Langostinos abiertos en mariposa con leche de tigre de ají amarillo y aceite de culantro.',
          en: 'Butterflied prawns with ají amarillo leche de tigre and cilantro oil.',
        },
        basePriceMinor: crc(11500),
        tags: [],
        image: {
          storageKey: '11-langostinos-crudos',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Langostinos crudos en un plato de piedra sobre fondo negro.',
            en: 'Raw prawns on a stone plate against a black background.',
          },
        },
        optionGroups: [],
      },
    ],
  },
  {
    slug: 'makis',
    name: { es: 'Makis', en: 'Maki rolls' },
    description: {
      es: 'Rollos de la barra nikkei, de 10 piezas.',
      en: 'Rolls from the nikkei bar, 10 pieces each.',
    },
    products: [
      {
        slug: 'maki-acevichado',
        name: 'Maki acevichado',
        description: {
          es: 'Langostino empanizado y palta por dentro, cubierto de pescado del día y salsa acevichada.',
          en: 'Breaded prawn and avocado inside, topped with the catch of the day and acevichada, a ceviche-style mayo.',
        },
        basePriceMinor: crc(7900),
        tags: [],
        image: {
          storageKey: '14-makis-tabla',
          width: 1351,
          height: 2400,
          alt: {
            es: 'Piezas de maki sobre una tabla de madera, con un platito de soya.',
            en: 'Maki pieces on a wooden board, with a small dish of soy sauce.',
          },
        },
        optionGroups: [SALSAS_MAKI],
      },
      {
        slug: 'maki-furai',
        name: 'Maki furai de langostino',
        description: {
          es: 'Rollo frito en panko con langostino, queso crema y cebollín, con salsa anticuchera.',
          en: 'Panko-crusted fried roll with prawn, cream cheese and chives, served with anticuchera sauce.',
        },
        basePriceMinor: crc(8200),
        tags: [],
        image: {
          storageKey: '15-maki-palillos',
          width: 1920,
          height: 2400,
          alt: {
            es: 'Una pieza de maki sostenida con palillos sobre fondo oscuro.',
            en: 'A maki piece held with chopsticks against a dark background.',
          },
        },
        optionGroups: [SALSAS_MAKI],
      },
    ],
  },
  {
    slug: 'bowls',
    name: { es: 'Bowls', en: 'Bowls' },
    description: {
      es: 'Pensados para viajar bien: llegan como salen de la barra.',
      en: 'Made to travel well: they arrive just as they leave the bar.',
    },
    products: [
      {
        slug: 'bowl-nikkei-de-atun',
        name: 'Bowl nikkei de atún',
        description: {
          es: 'Atún marinado en shoyu, palta, pepino, edamame, alga wakame y sésamo.',
          en: 'Shoyu-marinated tuna, avocado, cucumber, edamame, wakame and sesame.',
        },
        basePriceMinor: crc(8600),
        tags: [],
        image: {
          storageKey: '12-bowl-nikkei-delivery',
          width: 1603,
          height: 2400,
          alt: {
            es: 'Bowl visto desde arriba en un envase para llevar, sobre fondo negro.',
            en: 'Bowl seen from above in a takeaway container, against a black background.',
          },
        },
        optionGroups: [
          {
            name: { es: 'Base', en: 'Base' },
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: { es: 'Arroz de sushi', en: 'Sushi rice' }, priceDeltaMinor: 0, isDefault: true },
              { name: { es: 'Mezcla de hojas', en: 'Mixed greens' }, priceDeltaMinor: 0 },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'calientes',
    name: { es: 'Calientes', en: 'Grilled dishes' },
    description: {
      es: 'De la parrilla, para quien prefiere algo caliente.',
      en: 'Off the grill, for those who prefer something hot.',
    },
    products: [
      {
        slug: 'pulpo-a-la-parrilla',
        name: 'Pulpo a la parrilla',
        description: {
          es: 'Pulpo del Golfo de Nicoya a la parrilla con puré de camote y aceite de páprika.',
          en: 'Grilled Gulf of Nicoya octopus with sweet potato purée and paprika oil.',
        },
        basePriceMinor: crc(12400),
        tags: [],
        image: {
          storageKey: '16-pulpo-parrilla',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Pulpo a la parrilla sobre puré naranja en un plato oscuro.',
            en: 'Grilled octopus on an orange purée on a dark plate.',
          },
        },
        optionGroups: [],
      },
      {
        slug: 'pulpo-anticuchero',
        name: 'Pulpo anticuchero',
        description: {
          es: 'Pulpo glaseado en salsa anticuchera de ají panca, con papas nativas y choclo.',
          en: 'Octopus glazed with anticuchera sauce made from ají panca, with native potatoes and corn.',
        },
        basePriceMinor: crc(12900),
        // Sin "Picante": el ají panca es un ají suave y ahumado (revisión de etiquetas de M2).
        tags: [],
        // Muestra el estado "Agotado hoy" (§3.6) con datos reales.
        isAvailable: false,
        image: {
          storageKey: '17-pulpo-ceramica-azul',
          width: 1600,
          height: 2400,
          alt: {
            es: 'Pulpo en un plato de cerámica azul moteada.',
            en: 'Octopus on a speckled blue ceramic plate.',
          },
        },
        optionGroups: [],
      },
    ],
  },
  {
    slug: 'bebidas',
    name: { es: 'Bebidas', en: 'Drinks' },
    description: {
      es: 'Hechas en la casa, sin alcohol.',
      en: 'Made in house, alcohol-free.',
    },
    products: [
      {
        slug: 'chicha-morada',
        name: 'Chicha morada',
        description: {
          es: 'Maíz morado hervido con piña, canela y clavo de olor, servida fría.',
          en: 'Purple corn simmered with pineapple, cinnamon and clove, served cold.',
        },
        basePriceMinor: crc(2200),
        tags: ['VEGETARIAN', 'GLUTEN_FREE'],
        optionGroups: [],
      },
      {
        slug: 'limonada-de-hierbabuena',
        name: 'Limonada de hierbabuena',
        nameEn: 'Mint lemonade',
        description: {
          es: 'Limón mesino, hierbabuena fresca y un toque de tapa de dulce.',
          en: 'Mesino lime, fresh mint and a touch of tapa de dulce (unrefined cane sugar).',
        },
        basePriceMinor: crc(2000),
        tags: ['VEGETARIAN', 'GLUTEN_FREE'],
        optionGroups: [],
      },
      {
        slug: 'agua-de-pipa',
        name: 'Agua de pipa',
        nameEn: 'Fresh coconut water',
        description: {
          es: 'Agua de coco fresca, servida en la pipa.',
          en: 'Fresh coconut water, served in the coconut.',
        },
        basePriceMinor: crc(1800),
        tags: ['VEGETARIAN', 'GLUTEN_FREE'],
        optionGroups: [],
      },
    ],
  },
];

// ─── Configuración (§6.1, §6.2) ─────────────────────────────────────────────

export const SETTINGS = {
  currency: 'CRC',
  pricesIncludeTax: true,
  /** Se cobra al colón entero (§6.2): 100 céntimos. */
  roundingIncrementMinor: 100,
  minOrderMinor: crc(5000),
  pickupEnabled: true,
  deliveryEnabled: true,
  timezone: 'America/Costa_Rica',
  isDemo: true,
  /** Valores por defecto de D8 (§8.4); se ajustan desde el admin en M8. */
  turnstileGlobalThreshold: 50,
  turnstileWindowMinutes: 60,
} as const;

const minutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** 0 = domingo … 6 = sábado. Cerrado los lunes. */
export const OPENING_HOURS: readonly { dayOfWeek: number; opensMinutes: number; closesMinutes: number }[] = [
  { dayOfWeek: 0, opensMinutes: minutes('12:00'), closesMinutes: minutes('17:00') },
  { dayOfWeek: 2, opensMinutes: minutes('12:00'), closesMinutes: minutes('21:30') },
  { dayOfWeek: 3, opensMinutes: minutes('12:00'), closesMinutes: minutes('21:30') },
  { dayOfWeek: 4, opensMinutes: minutes('12:00'), closesMinutes: minutes('21:30') },
  { dayOfWeek: 5, opensMinutes: minutes('12:00'), closesMinutes: minutes('22:30') },
  { dayOfWeek: 6, opensMinutes: minutes('12:00'), closesMinutes: minutes('22:30') },
];

/** Valores fiscales semilla aprobados (D5). `DINE_IN` solo existe en el cargo inactivo (C10). */
export const TAX_RATES = [
  {
    key: 'iva',
    name: 'IVA',
    rateBps: 1300,
    appliesTo: 'BOTH',
    fulfillmentTypes: ['PICKUP', 'DELIVERY'],
    isActive: true,
  },
  {
    key: 'servicio',
    name: 'Cargo de servicio',
    rateBps: 1000,
    appliesTo: 'ITEMS',
    fulfillmentTypes: ['DINE_IN'],
    isActive: false,
  },
] as const;

/** Zonas de delivery alrededor de Barrio Escalante (dirección del local ficticia, S7). */
export const DELIVERY_ZONES = [
  {
    key: 'escalante',
    name: 'Escalante, Los Yoses y Barrio Dent',
    districts: ['Carmen', 'San Pedro'],
    feeMinor: crc(1200),
    etaMinutes: 30,
  },
  {
    key: 'montes-de-oca',
    name: 'Sabanilla, Curridabat y Zapote',
    districts: ['Sabanilla', 'Curridabat', 'Zapote'],
    feeMinor: crc(1800),
    etaMinutes: 40,
  },
  {
    key: 'norte',
    name: 'Guadalupe y Moravia',
    districts: ['Guadalupe', 'San Vicente'],
    feeMinor: crc(2500),
    etaMinutes: 50,
  },
] as const;

export const ROLES = ['CUSTOMER', 'STAFF', 'ADMIN'] as const;

/** Pizarra de pesca del día de ejemplo (hora local de Costa Rica). */
export const CATCH_ITEMS = [
  { species: 'Corvina', port: 'Puntarenas', arrivedAt: '06:40' },
  { species: 'Pargo rojo', port: 'Golfo de Nicoya', arrivedAt: '07:15' },
  { species: 'Atún aleta amarilla', port: 'Quepos', arrivedAt: '05:55' },
] as const;
