import {
  CART_MAX_LINES,
  PRODUCT_MAX_QUANTITY,
  guestCartSchema,
  lineKey,
  type CartLineInput,
  type GuestCart,
} from '@marea-baja/shared';
import { useSyncExternalStore } from 'react';

/**
 * Carrito de invitado (§7.5, D3): vive en `localStorage` y guarda **solo referencias** (plato,
 * opciones y cantidad), nunca precios ni totales: la API los calcula siempre.
 *
 * - Si el almacenamiento no está disponible (navegación privada, bloqueado), el carrito funciona en
 *   memoria durante la visita.
 * - Un valor dañado o de otra versión se descarta en lugar de romper la página.
 * - Las demás pestañas se enteran por el evento `storage`.
 * - En el prerender y al hidratar no hay carrito (`getServerSnapshot`): el HTML coincide.
 */
const STORAGE_KEY = 'marea-baja:pedido';

type Listener = () => void;
const listeners = new Set<Listener>();
let memory: GuestCart | null = null;
let cached: GuestCart | null | undefined;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(): GuestCart | null {
  const store = storage();
  if (!store) return memory;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = guestCartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return memory;
  }
}

function write(cart: GuestCart | null): void {
  memory = cart;
  cached = cart;
  const store = storage();
  try {
    if (cart && cart.lines.length > 0) store?.setItem(STORAGE_KEY, JSON.stringify(cart));
    else store?.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento: queda en memoria.
  }
  for (const listener of listeners) listener();
}

function snapshot(): GuestCart | null {
  if (cached === undefined) cached = read();
  return cached;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cached = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = (): GuestCart | null => null;

/** Carrito del invitado, o `null` si está vacío (también en el prerender y al hidratar). */
export function useGuestCart(): GuestCart | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function readGuestCart(): GuestCart | null {
  return snapshot();
}

function newCart(): GuestCart {
  return { version: 1, mergeKey: crypto.randomUUID(), lines: [] };
}

export type GuestChangeResult = 'ok' | 'quantityLimit' | 'linesLimit';

/** Suma o fija la cantidad **total** de una identidad (plato + opciones ordenadas). */
export function changeGuestLine(line: CartLineInput, mode: 'add' | 'set'): GuestChangeResult {
  const cart = snapshot() ?? newCart();
  const optionIds = [...new Set(line.optionIds ?? [])].sort();
  const key = lineKey(line.productId, optionIds);
  const index = cart.lines.findIndex((l) => lineKey(l.productId, l.optionIds) === key);
  const current = index === -1 ? 0 : (cart.lines[index]?.quantity ?? 0);
  const total = mode === 'add' ? current + line.quantity : line.quantity;
  if (total > PRODUCT_MAX_QUANTITY) return 'quantityLimit';
  let lines = [...cart.lines];
  if (total <= 0) lines = lines.filter((_, i) => i !== index);
  else if (index === -1) {
    if (lines.length >= CART_MAX_LINES) return 'linesLimit';
    lines.push({ productId: line.productId, optionIds, quantity: total });
  } else lines[index] = { productId: line.productId, optionIds, quantity: total };
  write({ ...cart, lines });
  return 'ok';
}

/** Tras una fusión correcta: el carrito pasa a la cuenta y el del navegador se borra (§7.5, paso 3). */
export function clearGuestCart(): void {
  write(null);
}
