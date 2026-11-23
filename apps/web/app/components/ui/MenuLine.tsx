import type { ReactNode } from 'react';
import { Link } from 'react-router';
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
  /** M4: el nombre enlaza a la página del plato. */
  href?: string;
  /** M4: nombre traducido cuando el original es descriptivo (§4.5). */
  translatedName?: string | null;
  /** M4: idioma real de la descripción si difiere del de la página (traducción pendiente, §4.5). */
  descriptionLang?: string;
  /** M5: acción de la línea ("Agregar"), debajo de la descripción. */
  action?: ReactNode;
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
  href,
  translatedName,
  descriptionLang,
  action,
}: MenuLineProps) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-border py-4">
      <Heading
        className={`flex min-w-0 items-baseline gap-2.5 font-display text-xl leading-7 font-semibold lg:after:min-w-5 lg:after:flex-1 lg:after:translate-y-[-4px] lg:after:border-b lg:after:border-dotted lg:after:border-border-strong lg:after:content-[''] ${soldOut ? 'text-text-muted' : ''}`}
      >
        {/* D2: nombre original del plato; los traductores automáticos no deben cambiarlo. */}
        {href ? (
          <Link
            to={href}
            translate="no"
            className="min-w-0 underline-offset-4 [overflow-wrap:anywhere] hover:underline focus-visible:underline"
          >
            {name}
          </Link>
        ) : (
          <span translate="no" className="min-w-0 [overflow-wrap:anywhere]">
            {name}
          </span>
        )}
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
      {translatedName ? <p className="col-span-2 t-ui text-text">{translatedName}</p> : null}
      <p
        lang={descriptionLang}
        className="col-span-2 max-w-[58ch] text-[0.9375rem] leading-6 text-text-muted"
      >
        {description}
      </p>
      {tags ? <div className="col-span-2 flex flex-wrap gap-2 pt-1">{tags}</div> : null}
      {action ? <div className="col-span-2 pt-2">{action}</div> : null}
    </article>
  );
}
