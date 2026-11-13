import { useState, type ReactNode } from 'react';
import { Hanko } from '../components/brand/Hanko.tsx';
import { Logo, WaveBowl } from '../components/brand/Logo.tsx';
import { TideLine } from '../components/brand/TideLine.tsx';
import { Button } from '../components/ui/Button.tsx';
import { DemoBanner } from '../components/ui/DemoBanner.tsx';
import { ErrorSummary } from '../components/ui/ErrorSummary.tsx';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher.tsx';
import { MenuLine } from '../components/ui/MenuLine.tsx';
import { OptionGroup } from '../components/ui/OptionGroup.tsx';
import { Price } from '../components/ui/Price.tsx';
import { QuantityStepper } from '../components/ui/QuantityStepper.tsx';
import { MenuLineSkeleton } from '../components/ui/Skeleton.tsx';
import { MAIN_ID, SkipLink } from '../components/ui/SkipLink.tsx';
import { Tag } from '../components/ui/Tag.tsx';
import { TextField } from '../components/ui/TextField.tsx';
import { contrastRatio, wcagLevel } from '../design/contrast.ts';
import { COLORS, CONTRAST_PAIRS, DERIVED, PALETTE, type ColorName } from '../design/palette.ts';
import { GLYPH_SAMPLES, LONGEST_PRICE_MINOR, SAMPLE_DISHES } from '../design/samples.ts';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import type { Route } from './+types/design';

export function meta({ location }: Route.MetaArgs) {
  const t = i18n.getFixedT(localeFromPathname(location.pathname), 'design');
  return [{ title: t('metaTitle') }, { name: 'robots', content: 'noindex, nofollow' }];
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6 border-t border-border pt-10">
      <div className="flex max-w-[65ch] flex-col gap-2">
        <h2 id={id} className="t-h2">
          {title}
        </h2>
        {intro ? <p className="t-body text-text-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children, dark = false }: { label: string; children: ReactNode; dark?: boolean }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5">
      <div className={dark ? 'on-dark bg-surface-inverse p-4 text-text-inverse' : ''}>{children}</div>
      <figcaption className="text-[0.8125rem] leading-5 text-text-muted in-[.on-dark]:text-text-inverse-muted">
        {label}
      </figcaption>
    </figure>
  );
}

export default function Design() {
  const { t } = useT('design');
  const { t: tc } = useT();
  const locale = useLocale();
  const [quantity, setQuantity] = useState(25);
  // El código HEX va debajo de la muestra, sobre Sal: nunca texto pequeño sobre el color crudo.
  const swatch = (name: ColorName) => (
    <li key={name} className="flex min-w-0 flex-col border border-border">
      <span aria-hidden="true" className="h-20" style={{ background: COLORS[name] }} />
      <span className="flex flex-col bg-surface-raised p-2 text-sm leading-5">
        <span>{t(`colors.names.${name}`)}</span>
        <span className="text-text-muted tabular-nums">{COLORS[name]}</span>
      </span>
    </li>
  );

  return (
    <>
      <SkipLink />
      <DemoBanner />
      <header className="on-dark bg-surface-inverse text-text-inverse">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
          <Logo />
          <LanguageSwitcher tone="dark" />
        </div>
      </header>

      <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex max-w-7xl flex-col gap-14 px-4 py-12 md:px-8">
        <div className="flex max-w-[65ch] flex-col gap-3">
          <p className="t-meta text-text-muted">{t('eyebrow')}</p>
          <h1 className="t-h1">{t('title')}</h1>
          <p className="t-body-lg text-text-muted">{t('intro')}</p>
        </div>

        <Section id="marca" title={t('brand.title')} intro={t('brand.intro')}>
          <div className="grid gap-8 md:grid-cols-2">
            <Specimen label={t('brand.logoLight')}>
              <div className="flex flex-wrap items-end gap-8">
                <Logo />
                <Logo layout="stacked" size={56} />
              </div>
            </Specimen>
            <Specimen label={t('brand.logoDark')} dark>
              <div className="flex flex-wrap items-end gap-8">
                <Logo />
                <WaveBowl size={24} />
              </div>
            </Specimen>
            <Specimen label={t('brand.hanko')}>
              <div className="flex items-end gap-6">
                <Hanko size={48} />
                <Hanko size={72} />
              </div>
            </Specimen>
            <Specimen label={t('brand.tide')}>
              <TideLine className="text-text-muted" />
            </Specimen>
          </div>
        </Section>

        <Section id="color" title={t('colors.title')} intro={t('colors.intro')}>
          <h3 className="t-h3">{t('colors.palette')}</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(PALETTE) as ColorName[]).map((name) => swatch(name))}
          </ul>
          <h3 className="t-h3">{t('colors.derived')}</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(DERIVED) as ColorName[]).map((name) => swatch(name))}
          </ul>
          <h3 className="t-h3">{t('colors.contrastTitle')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-text">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('colors.table.sample')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('colors.table.pair')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('colors.table.ratio')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t('colors.table.use')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {CONTRAST_PAIRS.map((pair) => {
                  const ratio = contrastRatio(COLORS[pair.fg], COLORS[pair.bg]);
                  const shown = pair.use !== 'never';
                  return (
                    <tr key={pair.id} className="border-b border-border">
                      <td className="py-2 pr-4">
                        {shown ? (
                          <span
                            className={`inline-block px-2 py-1 ${pair.use === 'large' ? 'font-display text-2xl font-semibold' : ''}`}
                            style={{ color: COLORS[pair.fg], background: COLORS[pair.bg] }}
                          >
                            {t('colors.table.sampleText')}
                          </span>
                        ) : (
                          <span
                            aria-hidden="true"
                            className="inline-flex h-8 w-16 border border-border"
                            style={{
                              background: `linear-gradient(90deg, ${COLORS[pair.fg]} 50%, ${COLORS[pair.bg]} 50%)`,
                            }}
                          />
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {t(`colors.names.${pair.fg}`)} / {t(`colors.names.${pair.bg}`)}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(ratio)}:1 ·{' '}
                        {t(`colors.level.${wcagLevel(ratio)}`)}
                      </td>
                      <td className="py-2">{t(`colors.use.${pair.use}`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="tipografia" title={t('type.title')} intro={t('type.intro')}>
          <dl className="flex flex-col">
            {(
              [
                ['t-display', 'display'],
                ['t-h1', 'h1'],
                ['t-h2', 'h2'],
                ['t-h3', 'h3'],
                ['t-body-lg', 'bodyLg'],
                ['t-body', 'body'],
                ['t-ui', 'ui'],
                ['t-meta', 'meta'],
              ] as const
            ).map(([cls, key]) => (
              <div
                key={key}
                className="grid gap-1 border-b border-border py-4 md:grid-cols-[12rem_1fr] md:gap-6"
              >
                <dt className="text-[0.8125rem] leading-5 text-text-muted">{t(`type.tokens.${key}`)}</dt>
                <dd className={`m-0 min-w-0 ${cls}`}>{t(`type.samples.${key}`)}</dd>
              </div>
            ))}
            <div className="grid gap-1 border-b border-border py-4 md:grid-cols-[12rem_1fr] md:gap-6">
              <dt className="text-[0.8125rem] leading-5 text-text-muted">{t('type.tokens.price')}</dt>
              <dd className="m-0 flex flex-wrap gap-6">
                <Price amountMinor={890_000} />
                <Price amountMinor={LONGEST_PRICE_MINOR} />
                <Price amountMinor={1250} currency="USD" />
              </dd>
            </div>
          </dl>
        </Section>

        <Section id="glifos" title={t('glyphs.title')} intro={t('glyphs.intro')}>
          <div className="grid gap-6 lg:grid-cols-2">
            {(
              [
                ['font-display font-semibold', 'displaySemibold'],
                ['font-display font-extrabold', 'displayExtrabold'],
                ['font-sans font-normal', 'sansRegular'],
                ['font-sans font-medium', 'sansMedium'],
                ['font-sans font-bold', 'sansBold'],
              ] as const
            ).map(([cls, key]) => (
              <Specimen key={key} label={t(`glyphs.fonts.${key}`)}>
                <div data-glyph-sample={key} className={`flex flex-col gap-1 text-2xl leading-9 ${cls}`}>
                  {GLYPH_SAMPLES.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </Specimen>
            ))}
          </div>
        </Section>

        <Section id="botones" title={t('buttons.title')} intro={t('buttons.intro')}>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Specimen label={t('buttons.states.rest')}>
              <Button>{t('buttons.addLabel')}</Button>
            </Specimen>
            <Specimen label={t('buttons.states.hover')}>
              <Button forceState="hover">{t('buttons.addLabel')}</Button>
            </Specimen>
            <Specimen label={t('buttons.states.focus')}>
              <Button forceState="focus">{t('buttons.addLabel')}</Button>
            </Specimen>
            <Specimen label={t('buttons.states.active')}>
              <Button forceState="active">{t('buttons.addLabel')}</Button>
            </Specimen>
            <Specimen label={t('buttons.states.loading')}>
              <Button loading>{t('buttons.addLabel')}</Button>
            </Specimen>
            <Specimen label={t('buttons.states.disabled')}>
              <Button disabledReason={t('buttons.disabledReason')}>{t('buttons.addLabel')}</Button>
            </Specimen>
            <Specimen label={t('buttons.variants.secondary')}>
              <Button variant="secondary">{t('buttons.seeMenu')}</Button>
            </Specimen>
            <Specimen label={t('buttons.variants.text')}>
              <Button variant="text">{t('buttons.editOptions')}</Button>
            </Specimen>
            <Specimen label={t('buttons.variants.danger')}>
              <Button variant="danger">{t('buttons.cancelOrder')}</Button>
            </Specimen>
          </div>
          <div className="on-dark grid grid-cols-1 gap-6 bg-surface-inverse p-6 text-text-inverse sm:grid-cols-2 lg:grid-cols-4">
            <Specimen label={t('buttons.onDark.primary')}>
              <Button tone="dark">{t('buttons.orderNow')}</Button>
            </Specimen>
            <Specimen label={t('buttons.onDark.hover')}>
              <Button tone="dark" forceState="hover">
                {t('buttons.orderNow')}
              </Button>
            </Specimen>
            <Specimen label={t('buttons.onDark.focus')}>
              <Button tone="dark" forceState="focus">
                {t('buttons.orderNow')}
              </Button>
            </Specimen>
            <Specimen label={t('buttons.onDark.secondary')}>
              <Button tone="dark" variant="secondary">
                {t('buttons.catchOfTheDay')}
              </Button>
            </Specimen>
          </div>
        </Section>

        <Section id="formularios" title={t('forms.title')} intro={t('forms.intro')}>
          <div className="grid gap-10 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <ErrorSummary
                headingLevel={3}
                errors={[
                  { fieldId: 'f-tel-error', message: t('forms.errors.phone') },
                  { fieldId: 'f-ref', message: t('forms.errors.reference') },
                ]}
              />
              <TextField
                id="f-nombre"
                label={t('forms.name')}
                autoComplete="given-name"
                defaultValue="Valeria"
              />
              <TextField
                id="f-nombre-hover"
                label={t('forms.nameHover')}
                defaultValue="Valeria"
                forceState="hover"
              />
              <TextField
                id="f-nombre-focus"
                label={t('forms.nameFocus')}
                defaultValue="Valeria"
                forceState="focus"
              />
            </div>
            <div className="flex flex-col gap-6">
              <TextField
                id="f-tel-error"
                label={t('forms.phone')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                defaultValue="8812-34"
                error={t('forms.errors.phoneField')}
              />
              <TextField id="f-ref" label={t('forms.reference')} hint={t('forms.referenceHint')} />
              <TextField id="f-disabled" label={t('forms.disabled')} defaultValue="San José" disabled />
            </div>
          </div>
        </Section>

        <Section id="opciones" title={t('options.title')} intro={t('options.intro')}>
          <div className="grid gap-10 lg:grid-cols-3">
            <OptionGroup
              legend={t('options.spice.legend')}
              type="single"
              defaultSelected={['suave']}
              options={[
                { id: 'suave', label: t('options.spice.mild'), priceDeltaMinor: 0 },
                { id: 'limo', label: t('options.spice.limo'), priceDeltaMinor: 0 },
                { id: 'rocoto', label: t('options.spice.rocoto'), priceDeltaMinor: 60_000 },
              ]}
            />
            <OptionGroup
              legend={t('options.extras.legend')}
              type="multiple"
              max={2}
              defaultSelected={['palta']}
              options={[
                { id: 'palta', label: t('options.extras.avocado'), priceDeltaMinor: 90_000 },
                { id: 'camote', label: t('options.extras.sweetPotato'), priceDeltaMinor: 50_000 },
                { id: 'chalaca', label: t('options.extras.chalaca'), priceDeltaMinor: 70_000 },
              ]}
            />
            <div className="flex flex-col gap-3">
              <QuantityStepper value={quantity} onChange={setQuantity} />
              <p className="max-w-[40ch] text-sm leading-5 text-text-muted">{t('options.quantityNote')}</p>
            </div>
          </div>
        </Section>

        <Section id="carta" title={t('menu.title')} intro={t('menu.intro')}>
          <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
            <div>
              <h3 className="t-h3 border-b border-text pb-2.5">{t('menu.category')}</h3>
              {SAMPLE_DISHES.map((dish) => (
                <MenuLine
                  headingLevel={4}
                  key={dish.key}
                  name={dish.name}
                  description={t(`menu.dishes.${dish.key}`)}
                  priceMinor={dish.priceMinor}
                  soldOut={'soldOut' in dish}
                  soldOutLabel={tc('tags.soldOutToday')}
                  tags={dish.tags.map((tag) => (
                    <Tag
                      key={tag}
                      variant={
                        tag === 'catchOfTheDay' ? 'highlight' : tag === 'soldOutToday' ? 'muted' : 'default'
                      }
                    >
                      {tc(`tags.${tag}`)}
                    </Tag>
                  ))}
                />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="t-h3">{t('menu.loading')}</h3>
              <MenuLineSkeleton />
            </div>
          </div>
        </Section>

        <Section id="movimiento" title={t('motion.title')} intro={t('motion.intro')}>
          <TideLine className="text-text-muted" />
        </Section>
      </main>
    </>
  );
}
