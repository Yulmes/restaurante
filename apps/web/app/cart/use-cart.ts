import {
  cartMergeResponseSchema,
  cartResponseSchema,
  type CartLineView,
  type CartMergeResponse,
  type CartView,
  type Locale,
} from '@marea-baja/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { apiGet, apiSend } from '../account/api.ts';
import { useSessionUser } from '../account/session.ts';
import { useLocale } from '../i18n/use-locale.ts';
import {
  changeGuestLine,
  clearGuestCart,
  readGuestCart,
  useGuestCart,
  type GuestChangeResult,
} from './guest-store.ts';

/**
 * Carrito unificado (M5, §7.5): el del invitado (navegador, valorizado por la API) o el de la
 * cuenta (PostgreSQL). La interfaz siempre trabaja con la cantidad **total** de cada producto
 * (regla C5) y muestra los importes que calcula la API.
 */
export const cartKey = (locale: Locale) => ['cart', locale] as const;
const quoteKey = (locale: Locale, lines: unknown) => ['cart-quote', locale, lines] as const;

export interface LineRef {
  productId: string;
  optionIds: readonly string[];
}

export type CartChangeError = Exclude<GuestChangeResult, 'ok'>;

export interface CartState {
  /** `undefined` mientras se averigua la sesión o se valoriza el carrito. */
  view: CartView | undefined;
  signedIn: boolean;
  ready: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
  add: (line: LineRef, quantity: number) => Promise<CartChangeError | null>;
  setQuantity: (line: LineRef, quantity: number) => Promise<CartChangeError | null>;
  remove: (line: LineRef) => Promise<CartChangeError | null>;
}

export function useCart(): CartState {
  const locale = useLocale();
  const client = useQueryClient();
  const me = useSessionUser();
  const signedIn = !!me.data;
  const guest = useGuestCart();
  const guestLines = guest?.lines ?? [];

  const server = useQuery({
    queryKey: cartKey(locale),
    queryFn: async () => (await apiGet(`/api/cart?locale=${locale}`, cartResponseSchema)).cart,
    enabled: signedIn,
    staleTime: 15_000,
  });
  const quote = useQuery({
    queryKey: quoteKey(locale, guestLines),
    queryFn: async () => {
      const res = await apiSend('POST', '/api/cart/quote', { locale, lines: guestLines }, cartResponseSchema);
      if (!res) throw new Error('Sin respuesta');
      return res.cart;
    },
    enabled: me.isFetched && !signedIn && guestLines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const change = useMutation({
    mutationFn: async (input: { line: LineRef; quantity: number; mode: 'add' | 'set' }) => {
      const res = await apiSend(
        'POST',
        '/api/cart/items',
        {
          locale,
          productId: input.line.productId,
          optionIds: input.line.optionIds,
          quantity: input.quantity,
          mode: input.mode,
        },
        cartResponseSchema,
      );
      return res?.cart;
    },
    onSuccess: (cart) => {
      if (cart) client.setQueryData(cartKey(locale), cart);
    },
  });

  const apply = async (
    line: LineRef,
    quantity: number,
    mode: 'add' | 'set',
  ): Promise<CartChangeError | null> => {
    if (signedIn) {
      await change.mutateAsync({ line, quantity, mode });
      return null;
    }
    const result = changeGuestLine(
      { productId: line.productId, optionIds: [...line.optionIds], quantity },
      mode,
    );
    return result === 'ok' ? null : result;
  };

  const emptyGuest = me.isFetched && !signedIn && guestLines.length === 0;
  const view: CartView | undefined = signedIn ? server.data : emptyGuest ? undefined : quote.data;
  return {
    view,
    signedIn,
    ready: me.isFetched && (signedIn ? server.isFetched : emptyGuest || quote.isFetched),
    isError: signedIn ? server.isError : quote.isError,
    isFetching: signedIn ? server.isFetching : quote.isFetching,
    refetch: () => {
      void (signedIn ? server.refetch() : quote.refetch());
    },
    add: (line, quantity) => apply(line, quantity, 'add'),
    setQuantity: (line, quantity) => apply(line, quantity, 'set'),
    remove: (line) => apply(line, 0, 'set'),
  };
}

// ─── Fusión al iniciar sesión (§7.5) ────────────────────────────────────────

/** Líneas del invitado que no entraron en la fusión: se muestran en el carrito (§7.5, paso 2). */
type MergeNotice = CartMergeResponse['unavailable'];
let notice: MergeNotice = [];
const noticeListeners = new Set<() => void>();
function setNotice(next: MergeNotice) {
  notice = next;
  for (const listener of noticeListeners) listener();
}

export function useMergeNotice(): [MergeNotice, () => void] {
  const value = useSyncExternalStore(
    (listener) => {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    () => notice,
    () => notice,
  );
  return [
    value,
    () => {
      setNotice([]);
    },
  ];
}

/**
 * Fusiona el carrito del navegador con el de la cuenta cuando hay sesión. El carrito del navegador
 * se borra **solo** con una respuesta correcta; si falla, se conserva y se reintenta con la misma
 * `mergeKey` (la API no vuelve a sumar una clave ya fusionada).
 */
export function CartSync(): null {
  const me = useSessionUser();
  const guest = useGuestCart();
  const locale = useLocale();
  const client = useQueryClient();
  const running = useRef<string | null>(null);
  const userId = me.data?.id;

  useEffect(() => {
    const cart = readGuestCart();
    if (!userId || !cart || cart.lines.length === 0 || running.current === cart.mergeKey) return;
    running.current = cart.mergeKey;
    apiSend(
      'POST',
      '/api/cart/merge',
      { locale, mergeKey: cart.mergeKey, lines: cart.lines },
      cartMergeResponseSchema,
    )
      .then((result) => {
        if (!result) return;
        // Solo si nadie cambió el carrito del navegador mientras tanto.
        if (readGuestCart()?.mergeKey === cart.mergeKey) clearGuestCart();
        client.setQueryData(cartKey(locale), result.cart);
        void client.invalidateQueries({ queryKey: ['cart'] });
        // El checkout pudo haber cotizado el carrito antes de la fusión: se vuelve a cotizar.
        void client.invalidateQueries({ queryKey: ['checkout-quote'] });
        if (result.unavailable.length > 0) setNotice(result.unavailable);
      })
      .catch(() => undefined)
      .finally(() => {
        running.current = null;
      });
  }, [userId, guest, locale, client]);

  return null;
}

export function lineRef(line: CartLineView): LineRef {
  return { productId: line.productId, optionIds: line.optionIds };
}
