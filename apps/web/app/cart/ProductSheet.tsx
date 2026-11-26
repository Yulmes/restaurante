import type { CatalogProduct } from '@marea-baja/shared';
import { useEffect, useId, useRef } from 'react';
import { Price } from '../components/ui/Price.tsx';
import { useT } from '../i18n/use-locale.ts';
import { ProductForm } from './ProductForm.tsx';

/**
 * Hoja de producto desde la carta (§3.6): sube desde abajo en el celular y se abre como panel
 * lateral en escritorio. `<dialog>` modal: foco atrapado, Escape cierra y el foco vuelve al botón
 * que la abrió (comportamiento nativo).
 */
export function ProductSheet({ product, onClose }: { product: CatalogProduct | null; onClose: () => void }) {
  const { t } = useT('site');
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (product && !node.open) node.showModal();
    if (!product && node.open) node.close();
  }, [product]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain border-t border-border bg-surface p-0 text-text backdrop:bg-tinta/40 md:mt-0 md:ml-auto md:h-dvh md:max-h-none md:w-[30rem] md:border-t-0 md:border-l"
    >
      {product ? (
        <div className="flex flex-col gap-6 px-4 pt-4 pb-8 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="t-h2" translate="no">
                {product.name}
              </h2>
              {product.translatedName ? <p className="t-body">{product.translatedName}</p> : null}
              <p className="t-body text-text-muted">
                <Price amountMinor={product.basePriceMinor} /> · {t('product.taxIncluded')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="inline-flex min-h-11 shrink-0 items-center px-2 t-ui underline underline-offset-4"
            >
              {t('cart.close')}
            </button>
          </div>
          <ProductForm key={product.id} product={product} idPrefix="sheet" />
        </div>
      ) : null}
    </dialog>
  );
}
