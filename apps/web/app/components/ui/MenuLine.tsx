import type { ReactNode } from 'react';
import { Price } from './Price.tsx';

interface MenuLineProps {
  /** Nombre original del plato (D2: no se traduce). */
  name: string;
  description: string;
  priceMinor: number;
  tags?: ReactNode;
  soldOut?: boolean;
  /** Texto accesible del precio tachado, por ejemplo "Agotado hoy". */
  soldOutLabel?: string;
  /** Un nivel por debajo del título de la categoría (en la carta real: h2 → h3). */
  headingLevel?: 3 | 4;
}

/**
 * Línea de carta editorial (§2.1, §3.6): nombre en serif, puntos guía en
 * escritorio y precio alineado con cifras tabulares. Sin foto por fila.
 */
export function MenuLine({
  name,
  description,
  priceMinor,
  tags,
  soldOut = false,
  soldOutLabel,
  headingLevel = 3,
}: MenuLineProps) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-border py-4">
      <Heading
        className={`flex min-w-0 items-baseline gap-2.5 font-display text-xl leading-7 font-semibold lg:after:min-w-5 lg:after:flex-1 lg:after:translate-y-[-4px] lg:after:border-b lg:after:border-dotted lg:after:border-border-strong lg:after:content-[''] ${soldOut ? 'text-text-muted' : ''}`}
      >
        {/* D2: nombre original del plato; los traductores automáticos no deben cambiarlo. */}
        <span translate="no" className="min-w-0 [overflow-wrap:anywhere]">
          {name}
        </span>
      </Heading>
      <span className={`self-baseline ${soldOut ? 'text-text-muted line-through' : ''}`}>
        <Price amountMinor={priceMinor} />
        {soldOut && soldOutLabel ? (
          <span className="sr-only">
            {', '}
            {soldOutLabel}
          </span>
        ) : null}
      </span>
      <p className="col-span-2 max-w-[58ch] text-[0.9375rem] leading-6 text-text-muted">{description}</p>
      {tags ? <div className="col-span-2 flex flex-wrap gap-2 pt-1">{tags}</div> : null}
    </article>
  );
}
