import {
  DIETARY_TAGS,
  adminMenuResponseSchema,
  adminProductResponseSchema,
  type AdminMenu,
  type AdminProduct,
  type DietaryTag,
} from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { apiGet, apiSend } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import {
  AdminPage,
  CheckField,
  Notice,
  SelectField,
  TextArea,
  adminMeta,
  fieldErrorsOf,
  fromMinor,
  toMinor,
  useErrorText,
  useFieldMessage,
  type NoticeState,
} from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { MenuLine } from '../../components/ui/MenuLine.tsx';
import { Tag } from '../../components/ui/Tag.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import { MENU_QUERY_KEY } from './carta.tsx';
import type { Route } from './+types/plato';

/**
 * Admin · Editor de plato (M8, §3.6 "formulario a la izquierda y vista previa en vivo de la línea
 * de carta a la derecha"; D2: el texto en inglés se edita junto al original). Crear (`/nuevo`) y
 * editar; el slug no cambia después de crearlo (§4.2). La foto: solo su texto alternativo
 * (D-M8-2). Los grupos y opciones se editan debajo, cada uno con su propio guardado.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'menu');
}

export default function AdminProductEditor() {
  const { t } = useT('admin');
  const { id = '' } = useParams();
  const creating = id === 'nuevo' || id === 'new';
  return (
    <AdminPage section="menu" title={creating ? t('product.newTitle') : t('product.title')}>
      <EditorBody id={id} creating={creating} />
    </AdminPage>
  );
}

function EditorBody({ id, creating }: { id: string; creating: boolean }) {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const menu = useQuery({
    queryKey: MENU_QUERY_KEY,
    queryFn: () => apiGet('/api/admin/menu', adminMenuResponseSchema),
    retry: false,
  });
  if (menu.isPending) {
    return (
      <p role="status" className="t-body text-text-muted">
        {t('access.loading')}
      </p>
    );
  }
  if (!menu.data) {
    return (
      <p role="alert" className="t-body text-danger">
        {t('errors.load')}
      </p>
    );
  }
  const product = menu.data.categories.flatMap((c) => c.products).find((p) => p.id === id);
  if (!creating && !product) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="t-body">
          {t('product.notFound')}
        </p>
        <Link to={to('/admin/carta')} className="t-ui underline underline-offset-4">
          {t('product.back')}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      <p>
        <Link to={to('/admin/carta')} className="t-ui underline underline-offset-4">
          {t('product.back')}
        </Link>
      </p>
      <ProductForm key={product?.id ?? 'new'} menu={menu.data} product={product} />
      {product && product.optionGroups.length > 0 ? (
        <OptionsEditor product={product} menu={menu.data} />
      ) : null}
    </div>
  );
}

interface FormState {
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  price: string;
  tags: DietaryTag[];
  isActive: boolean;
  isAvailable: boolean;
  sortOrder: string;
  enName: string;
  enDescription: string;
  enAltText: string;
  imageAlt: string;
}

function ProductForm({ menu, product }: { menu: AdminMenu; product: AdminProduct | undefined }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const client = useQueryClient();
  const navigate = useNavigate();
  const to = useLocalizedPath();
  const currency = menu.currency;
  const [form, setForm] = useState<FormState>({
    slug: product?.slug ?? '',
    categoryId: product?.categoryId ?? menu.categories[0]?.id ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: product ? fromMinor(product.basePriceMinor, currency) : '',
    tags: product?.tags ?? [],
    isActive: product?.isActive ?? true,
    isAvailable: product?.isAvailable ?? true,
    sortOrder: String(product?.sortOrder ?? 0),
    enName: product?.en.name ?? '',
    enDescription: product?.en.description ?? '',
    enAltText: product?.en.altText ?? '',
    imageAlt: product?.image?.alt ?? '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>(null);
  const priceMinor = toMinor(form.price, currency);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: form.categoryId,
        name: form.name,
        description: form.description,
        basePriceMinor: priceMinor ?? -1,
        tags: form.tags,
        isActive: form.isActive,
        isAvailable: form.isAvailable,
        sortOrder: Number(form.sortOrder) || 0,
        en: { name: form.enName || null, description: form.enDescription, altText: form.enAltText || null },
        imageAlt: form.imageAlt || null,
      };
      return product
        ? apiSend(
            'PUT',
            `/api/admin/products/${product.id}`,
            { ...body, updatedAt: product.updatedAt },
            adminProductResponseSchema,
          )
        : apiSend('POST', '/api/admin/products', { ...body, slug: form.slug }, adminProductResponseSchema);
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: MENU_QUERY_KEY });
      if (!product && result) {
        void navigate(to(`/admin/carta/${result.product.id}`), { replace: true });
        return;
      }
      setNotice({ tone: 'ok', text: t('product.saved', { name: form.name }) });
    },
    onError: (error) => {
      setFields(fieldErrorsOf(error));
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setNotice(null);
    if (priceMinor === null) {
      setFields({ basePriceMinor: 'money' });
      setNotice({ tone: 'error', text: t('errors.VALIDATION_FAILED') });
      return;
    }
    save.mutate();
  }
  const set = (key: keyof FormState) => (event: { target: { value: string } }) => {
    setForm({ ...form, [key]: event.target.value });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-6">
        <Notice notice={notice} />
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 t-h3">{t('product.original')}</legend>
          {!product ? (
            <TextField
              id="product-slug"
              label={t('menu.slug')}
              hint={t('menu.slugHint')}
              value={form.slug}
              error={fieldMessage(fields['slug'])}
              onChange={set('slug')}
            />
          ) : (
            <p className="text-sm leading-5 text-text-muted">
              {t('product.slugFixed', { slug: product.slug })}
            </p>
          )}
          <TextField
            id="product-name"
            label={t('product.name')}
            hint={t('product.nameHint')}
            value={form.name}
            error={fieldMessage(fields['name'])}
            onChange={set('name')}
          />
          <TextArea
            id="product-description"
            label={t('menu.descriptionEs')}
            value={form.description}
            error={fieldMessage(fields['description'])}
            maxLength={600}
            onChange={set('description')}
          />
          <TextField
            id="product-price"
            label={t('product.price', { currency })}
            hint={currency === 'CRC' ? t('product.priceHintCrc') : t('product.priceHintUsd')}
            inputMode="decimal"
            value={form.price}
            error={fieldMessage(fields['basePriceMinor'])}
            onChange={set('price')}
          />
          <SelectField
            id="product-category"
            label={t('product.category')}
            value={form.categoryId}
            error={fieldMessage(fields['categoryId'])}
            onChange={set('categoryId')}
          >
            {menu.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <fieldset className="flex flex-col gap-2">
            <legend className="t-ui">{t('product.tags')}</legend>
            {DIETARY_TAGS.map((tag) => (
              <CheckField
                key={tag}
                id={`product-tag-${tag}`}
                label={t(`tags.${tag}`)}
                checked={form.tags.includes(tag)}
                onChange={(checked) => {
                  setForm({
                    ...form,
                    tags: checked ? [...form.tags, tag] : form.tags.filter((x) => x !== tag),
                  });
                }}
              />
            ))}
          </fieldset>
          <TextField
            id="product-order"
            label={t('menu.sortOrder')}
            inputMode="numeric"
            value={form.sortOrder}
            error={fieldMessage(fields['sortOrder'])}
            onChange={set('sortOrder')}
          />
          <CheckField
            id="product-available"
            label={t('product.available')}
            hint={t('product.availableHint')}
            checked={form.isAvailable}
            onChange={(checked) => {
              setForm({ ...form, isAvailable: checked });
            }}
          />
          <CheckField
            id="product-active"
            label={t('product.active')}
            hint={t('product.activeHint')}
            checked={form.isActive}
            onChange={(checked) => {
              setForm({ ...form, isActive: checked });
            }}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 t-h3">{t('product.english')}</legend>
          <TextField
            id="product-en-name"
            lang="en"
            label={t('product.enName')}
            hint={t('product.enNameHint')}
            value={form.enName}
            error={fieldMessage(fields['en.name'])}
            onChange={set('enName')}
          />
          <TextArea
            id="product-en-description"
            lang="en"
            label={t('menu.descriptionEn')}
            value={form.enDescription}
            error={fieldMessage(fields['en.description'])}
            maxLength={600}
            onChange={set('enDescription')}
          />
        </fieldset>

        {product?.image ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 t-h3">{t('product.photo')}</legend>
            <p className="text-sm leading-5 text-text-muted">{t('product.photoHint')}</p>
            <TextField
              id="product-alt"
              label={t('product.altEs')}
              value={form.imageAlt}
              error={fieldMessage(fields['imageAlt'])}
              onChange={set('imageAlt')}
            />
            <TextField
              id="product-en-alt"
              lang="en"
              label={t('product.altEn')}
              value={form.enAltText}
              error={fieldMessage(fields['en.altText'])}
              onChange={set('enAltText')}
            />
          </fieldset>
        ) : null}

        <div>
          <Button type="submit" loading={save.isPending}>
            {product ? t('common.save') : t('product.create')}
          </Button>
        </div>
      </div>

      <aside aria-labelledby="preview-title" className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <h2 id="preview-title" className="t-h3">
          {t('product.preview')}
        </h2>
        <p className="text-sm leading-5 text-text-muted">{t('product.previewHint')}</p>
        <div className="flex flex-col gap-2">
          <p className="t-ui text-text-muted">{t('product.previewEs')}</p>
          <MenuLine
            name={form.name || t('product.previewEmpty')}
            description={form.description}
            priceMinor={priceMinor ?? 0}
            soldOut={!form.isAvailable}
            soldOutLabel={t('menu.soldOut')}
            tags={form.tags.map((tag) => (
              <Tag key={tag}>{t(`tags.${tag}`)}</Tag>
            ))}
          />
        </div>
        <div lang="en" className="flex flex-col gap-2">
          <p className="t-ui text-text-muted">{t('product.previewEn')}</p>
          <MenuLine
            name={form.name || t('product.previewEmpty')}
            translatedName={form.enName || null}
            description={form.enDescription || form.description}
            priceMinor={priceMinor ?? 0}
            soldOut={!form.isAvailable}
            soldOutLabel={t('menu.soldOut')}
          />
        </div>
      </aside>
    </form>
  );
}

function OptionsEditor({ product, menu }: { product: AdminProduct; menu: AdminMenu }) {
  const { t } = useT('admin');
  return (
    <section aria-labelledby="options-title" className="flex flex-col gap-6">
      <h2 id="options-title" className="t-h2">
        {t('product.options')}
      </h2>
      <p className="text-sm leading-5 text-text-muted">{t('product.optionsHint')}</p>
      {product.optionGroups.map((group) => (
        <GroupEditor key={group.id} group={group} currency={menu.currency} />
      ))}
    </section>
  );
}

function GroupEditor({
  group,
  currency,
}: {
  group: AdminProduct['optionGroups'][number];
  currency: 'CRC' | 'USD';
}) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const client = useQueryClient();
  const [notice, setNotice] = useState<NoticeState>(null);
  const [form, setForm] = useState({
    name: group.name,
    enName: group.enName ?? '',
    isActive: group.isActive,
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      enName: option.enName ?? '',
      price: fromMinor(option.priceDeltaMinor, currency),
      isAvailable: option.isAvailable,
      original: option,
    })),
  });

  const save = useMutation({
    mutationFn: async () => {
      await apiSend('PUT', `/api/admin/option-groups/${group.id}`, {
        name: form.name,
        enName: form.enName || null,
        isActive: form.isActive,
      });
      for (const option of form.options) {
        const priceDeltaMinor = toMinor(option.price, currency);
        if (priceDeltaMinor === null) throw new Error('money');
        const changed =
          option.name !== option.original.name ||
          (option.enName || null) !== option.original.enName ||
          priceDeltaMinor !== option.original.priceDeltaMinor ||
          option.isAvailable !== option.original.isAvailable;
        if (!changed) continue;
        await apiSend('PUT', `/api/admin/options/${option.id}`, {
          name: option.name,
          enName: option.enName || null,
          priceDeltaMinor,
          isAvailable: option.isAvailable,
        });
      }
    },
    onSuccess: () => {
      setNotice({ tone: 'ok', text: t('product.groupSaved', { name: form.name }) });
    },
    onError: (error) => {
      setNotice({
        tone: 'error',
        text: error instanceof Error && error.message === 'money' ? t('fields.money') : errorText(error),
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: MENU_QUERY_KEY });
    },
  });

  const prefix = `group-${group.id}`;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setNotice(null);
        save.mutate();
      }}
      className="flex flex-col gap-4 border-t-2 border-text pt-4"
    >
      <Notice notice={notice} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id={`${prefix}-name`}
          label={t('product.groupName')}
          value={form.name}
          onChange={(event) => {
            setForm({ ...form, name: event.target.value });
          }}
        />
        <TextField
          id={`${prefix}-en`}
          lang="en"
          label={t('product.groupNameEn')}
          value={form.enName}
          onChange={(event) => {
            setForm({ ...form, enName: event.target.value });
          }}
        />
      </div>
      <CheckField
        id={`${prefix}-active`}
        label={t('product.groupActive')}
        checked={form.isActive}
        onChange={(checked) => {
          setForm({ ...form, isActive: checked });
        }}
      />
      <ul className="flex flex-col gap-4">
        {form.options.map((option, index) => {
          const update = (changes: Partial<typeof option>) => {
            const options = [...form.options];
            options[index] = { ...option, ...changes };
            setForm({ ...form, options });
          };
          const id = `${prefix}-opt-${option.id}`;
          return (
            <li key={option.id} className="grid gap-3 border-b border-border pb-4 md:grid-cols-3">
              <TextField
                id={`${id}-name`}
                label={t('product.optionName')}
                value={option.name}
                onChange={(event) => {
                  update({ name: event.target.value });
                }}
              />
              <TextField
                id={`${id}-en`}
                lang="en"
                label={t('product.optionNameEn')}
                value={option.enName}
                onChange={(event) => {
                  update({ enName: event.target.value });
                }}
              />
              <TextField
                id={`${id}-price`}
                label={t('product.optionPrice', { currency })}
                inputMode="decimal"
                value={option.price}
                onChange={(event) => {
                  update({ price: event.target.value });
                }}
              />
              <div className="md:col-span-3">
                <CheckField
                  id={`${id}-available`}
                  label={t('product.optionAvailable')}
                  checked={option.isAvailable}
                  onChange={(checked) => {
                    update({ isAvailable: checked });
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div>
        <Button type="submit" variant="secondary" loading={save.isPending}>
          {t('product.saveGroup')}
        </Button>
      </div>
    </form>
  );
}
