import { AUDIT_ENTITY_TYPES, adminAuditResponseSchema, type AdminAuditEntry } from '@marea-baja/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { apiGet } from '../../account/api.ts';
import { AdminPage, SelectField, adminMeta, useDateTime } from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/auditoria';

/**
 * Admin · Auditoría (M8, §8.6 punto 4: "la UI de auditoría es solo lectura, con filtros"). Muestra
 * lo que la lista blanca dejó entrar: los correos llegan enmascarados y nunca hay secretos.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'audit');
}

export default function AdminAudit() {
  const { t } = useT('admin');
  return (
    <AdminPage section="audit" title={t('audit.title')} intro={t('audit.intro')}>
      <AuditBody />
    </AdminPage>
  );
}

interface Filters {
  entityType: string;
  action: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { entityType: '', action: '', from: '', to: '' };

function AuditBody() {
  const { t } = useT('admin');
  const dateTime = useDateTime();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'audit', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      for (const key of ['entityType', 'action', 'from', 'to'] as const) {
        if (filters[key]) params.set(key, filters[key]);
      }
      if (pageParam) params.set('cursor', pageParam);
      return apiGet(`/api/admin/audit?${params.toString()}`, adminAuditResponseSchema);
    },
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const entries = list.data?.pages.flatMap((page) => page.entries) ?? [];

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setFilters({ ...draft, action: draft.action.trim().toLowerCase() });
  }

  return (
    <div className="flex flex-col gap-6">
      <form role="search" onSubmit={onSubmit} className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SelectField
          id="audit-entity"
          label={t('audit.entity')}
          value={draft.entityType}
          onChange={(event) => {
            setDraft({ ...draft, entityType: event.target.value });
          }}
        >
          <option value="">{t('audit.allEntities')}</option>
          {AUDIT_ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`audit.entities.${type}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          id="audit-action"
          label={t('audit.action')}
          hint={t('audit.actionHint')}
          value={draft.action}
          onChange={(event) => {
            setDraft({ ...draft, action: event.target.value });
          }}
        />
        <TextField
          id="audit-from"
          type="date"
          label={t('audit.from')}
          value={draft.from}
          onChange={(event) => {
            setDraft({ ...draft, from: event.target.value });
          }}
        />
        <TextField
          id="audit-to"
          type="date"
          label={t('audit.to')}
          value={draft.to}
          onChange={(event) => {
            setDraft({ ...draft, to: event.target.value });
          }}
        />
        <div className="flex gap-3">
          <Button type="submit" variant="secondary">
            {t('common.filter')}
          </Button>
          <Button
            variant="text"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
            }}
          >
            {t('common.clear')}
          </Button>
        </div>
      </form>

      {list.isError ? (
        <p role="alert" className="t-body text-danger">
          {t('errors.load')}
        </p>
      ) : null}
      {list.isPending ? (
        <p role="status" className="t-body text-text-muted">
          {t('access.loading')}
        </p>
      ) : entries.length === 0 ? (
        <p className="t-body text-text-muted">{t('audit.empty')}</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} when={dateTime(entry.createdAt)} />
          ))}
        </ol>
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** Valor de la auditoría para leer: los JSON de la lista blanca son escalares o listas de escalares. */
function show(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((item: unknown) => show(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '—';
}

function AuditRow({ entry, when }: { entry: AdminAuditEntry; when: string }) {
  const { t } = useT('admin');
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return (
    <li className="flex flex-col gap-2 border-b border-border py-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="font-semibold">{entry.action}</code>
        <span className="text-sm text-text-muted">{when}</span>
      </p>
      <p className="t-body">
        {entry.actor
          ? t('audit.by', {
              name: entry.actor.name,
              role: entry.actor.role ? t(`roles.${entry.actor.role}`) : '',
            })
          : t('audit.bySystem')}
        {' · '}
        {t(`audit.entities.${entry.entityType as (typeof AUDIT_ENTITY_TYPES)[number]}`, {
          defaultValue: entry.entityType,
        })}{' '}
        <code className="text-sm [overflow-wrap:anywhere]">{entry.entityId}</code>
      </p>
      {entry.reason ? (
        <p className="text-sm leading-5">{t('audit.reason', { reason: entry.reason })}</p>
      ) : null}
      {changed.length > 0 ? (
        <details>
          <summary className="cursor-pointer t-ui">{t('audit.changes', { n: changed.length })}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
            {changed.map((key) => (
              <div key={key} className="contents">
                <dt className="font-semibold">{key}</dt>
                <dd className="[overflow-wrap:anywhere]">
                  {t('audit.change', { before: show(before[key]), after: show(after[key]) })}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </li>
  );
}
