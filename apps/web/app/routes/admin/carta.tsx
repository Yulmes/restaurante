import {
  adminCategoryResponseSchema,
  adminMenuResponseSchema,
  adminProductResponseSchema,
  type AdminCategory,
  type AdminProduct,
} from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { apiGet, apiSend } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import {
  AdminPage,
  CheckField,
  Notice,
  adminMeta,
  fieldErrorsOf,
  useErrorText,
  useFieldMessage,
  type NoticeState,
} from '../../admin/kit.tsx';
import { Button, buttonClassName } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/carta';

/**
 * Admin · Carta (M8, §3.6, §8.6, D2): categorías con su traducción y los platos con precio, estado y
 * "Agotado hoy" (un clic). El editor de cada plato está en `/admin/carta/:id`.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'menu');
}

export const MENU_QUERY_KEY = ['admin', 'menu'] as const;

export function productRequest(product: AdminProduct, changes: Partial<AdminProduct> = {}) {
  const next = { ...product, ...changes };
  return {
    updatedAt: next.updatedAt,
    categoryId: next.categoryId,
    name: next.name,
    description: next.description,
    basePriceMinor: next.basePriceMinor,
    tags: next.tags,
    isActive: next.isActive,
    isAvailable: next.isAvailable,
    sortOrder: next.sortOrder,
    en: { name: next.en.name, description: next.en.description ?? '', altText: next.en.altText },
    imageAlt: next.image?.alt ?? null,
  };
}

export default function AdminMenu() {
  const { t } = useT('admin');
  return (
    <AdminPage section="menu" title={t('menu.title')} intro={t('menu.intro')}>
      <MenuBody />
    </AdminPage>
  );
}

function MenuBody() {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const [notice, setNotice] = useState<NoticeState>(null);
  const [creating, setCreating] = useState(false);
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
  const { categories, currency } = menu.data;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-3">
        <Link to={to('/admin/carta/nuevo')} className={buttonClassName('primary')}>
          {t('menu.newProduct')}
        </Link>
        <Button
          variant="secondary"
          onClick={() => {
            setCreating((value) => !value);
          }}
          aria-expanded={creating}
        >
          {t('menu.newCategory')}
        </Button>
      </div>
      <Notice notice={notice} />
      {creating ? (
        <CategoryForm
          onDone={(text) => {
            setCreating(false);
            setNotice({ tone: 'ok', text });
          }}
          onError={setNotice}
        />
      ) : null}
      {categories.map((category) => (
        <CategorySection key={category.id} category={category} currency={currency} onNotice={setNotice} />
      ))}
    </div>
  );
}

function CategorySection({
  category,
  currency,
  onNotice,
}: {
  category: AdminCategory;
  currency: 'CRC' | 'USD';
  onNotice: (notice: NoticeState) => void;
}) {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const toggle = useMutation({
    mutationFn: (product: AdminProduct) =>
      apiSend(
        'PUT',
        `/api/admin/products/${product.id}`,
        productRequest(product, { isAvailable: !product.isAvailable }),
        adminProductResponseSchema,
      ),
    onSuccess: (result) => {
      const product = result?.product;
      if (!product) return;
      onNotice({
        tone: 'ok',
        text: product.isAvailable
          ? t('menu.nowAvailable', { name: product.name })
          : t('menu.nowSoldOut', { name: product.name }),
      });
    },
    onError: (error) => {
      onNotice({ tone: 'error', text: errorText(error) });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: MENU_QUERY_KEY });
    },
  });
  const headingId = `cat-${category.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-text pb-2">
        <h2 id={headingId} className="t-h2">
          {category.name}
          {category.en.name && category.en.name !== category.name ? (
            <span lang="en" className="ml-3 t-ui font-normal text-text-muted">
              {category.en.name}
            </span>
          ) : null}
          {!category.isActive ? <span className="ml-3 t-ui text-danger">{t('common.inactive')}</span> : null}
        </h2>
        <Button
          variant="text"
          aria-expanded={editing}
          onClick={() => {
            setEditing((value) => !value);
          }}
        >
          {t('menu.editCategory')}
        </Button>
      </div>
      {editing ? (
        <CategoryForm
          category={category}
          onDone={(text) => {
            setEditing(false);
            onNotice({ tone: 'ok', text });
          }}
          onError={onNotice}
        />
      ) : null}
      {category.products.length === 0 ? (
        <p className="t-body text-text-muted">{t('menu.emptyCategory')}</p>
      ) : (
        <ul className="flex flex-col">
          {category.products.map((product) => (
            <li
              key={product.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-border py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  to={to(`/admin/carta/${product.id}`)}
                  className="font-display text-lg font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                  translate="no"
                >
                  {product.name}
                </Link>
                <span className="text-sm leading-5 text-text-muted">
                  {[
                    !product.isActive ? t('common.inactive') : null,
                    !product.isAvailable ? t('menu.soldOut') : null,
                    product.en.description ? null : t('menu.missingEnglish'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <Price amountMinor={product.basePriceMinor} currency={currency} />
              <div className="col-span-2">
                <Button
                  variant="secondary"
                  loading={toggle.isPending && toggle.variables.id === product.id}
                  onClick={() => {
                    onNotice(null);
                    toggle.mutate(product);
                  }}
                >
                  {product.isAvailable ? t('menu.markSoldOut') : t('menu.markAvailable')}
                  {/* El nombre accesible incluye el texto visible y el plato (WCAG 2.5.3). */}
                  <span className="sr-only"> · {product.name}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryForm({
  category,
  onDone,
  onError,
}: {
  category?: AdminCategory;
  onDone: (text: string) => void;
  onError: (notice: NoticeState) => void;
}) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const client = useQueryClient();
  const prefix = category ? `cat-${category.id}` : 'cat-new';
  const [form, setForm] = useState({
    slug: '',
    name: category?.name ?? '',
    description: category?.description ?? '',
    enName: category?.en.name ?? '',
    enDescription: category?.en.description ?? '',
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        description: form.description || null,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        en: { name: form.enName, description: form.enDescription || null },
      };
      return category
        ? apiSend(
            'PUT',
            `/api/admin/categories/${category.id}`,
            { ...body, updatedAt: category.updatedAt },
            adminCategoryResponseSchema,
          )
        : apiSend('POST', '/api/admin/categories', { ...body, slug: form.slug }, adminCategoryResponseSchema);
    },
    onSuccess: () => {
      onDone(t('menu.categorySaved', { name: form.name }));
    },
    onError: (error) => {
      setFields(fieldErrorsOf(error));
      onError({ tone: 'error', text: errorText(error) });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: MENU_QUERY_KEY });
    },
  });
  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    onError(null);
    save.mutate();
  }
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [key]: event.target.value });
  };
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 bg-surface-raised p-4">
      {!category ? (
        <TextField
          id={`${prefix}-slug`}
          label={t('menu.slug')}
          hint={t('menu.slugHint')}
          value={form.slug}
          error={fieldMessage(fields['slug'])}
          onChange={set('slug')}
        />
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id={`${prefix}-name`}
          label={t('menu.nameEs')}
          value={form.name}
          error={fieldMessage(fields['name'])}
          onChange={set('name')}
        />
        <TextField
          id={`${prefix}-en-name`}
          lang="en"
          label={t('menu.nameEn')}
          value={form.enName}
          error={fieldMessage(fields['en.name'])}
          onChange={set('enName')}
        />
        <TextField
          id={`${prefix}-description`}
          label={t('menu.descriptionEs')}
          value={form.description}
          onChange={set('description')}
        />
        <TextField
          id={`${prefix}-en-description`}
          lang="en"
          label={t('menu.descriptionEn')}
          value={form.enDescription}
          onChange={set('enDescription')}
        />
        <TextField
          id={`${prefix}-order`}
          label={t('menu.sortOrder')}
          inputMode="numeric"
          value={form.sortOrder}
          error={fieldMessage(fields['sortOrder'])}
          onChange={set('sortOrder')}
        />
      </div>
      <CheckField
        id={`${prefix}-active`}
        label={t('menu.categoryActive')}
        checked={form.isActive}
        onChange={(checked) => {
          setForm({ ...form, isActive: checked });
        }}
      />
      <div>
        <Button type="submit" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
