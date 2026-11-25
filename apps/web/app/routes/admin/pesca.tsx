import { adminCatchResponseSchema, type AdminCatchResponse } from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiSend } from '../../account/api.ts';
import {
  AdminPage,
  Notice,
  SelectField,
  adminMeta,
  fieldErrorsOf,
  useDateTime,
  useErrorText,
  useFieldMessage,
  type NoticeState,
} from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/pesca';

/**
 * Admin · Pesca del día (M8, §3.6 "editable desde admin"; §8.6 "publicación de la pesca del día").
 * Se prepara la pizarra de hoy o de mañana y se publica; la portada muestra la última publicada.
 * Especies y puertos son nombres propios: no se traducen.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'catch');
}

const QUERY_KEY = ['admin', 'catch'] as const;

export default function AdminCatch() {
  const { t } = useT('admin');
  return (
    <AdminPage section="catch" title={t('catch.title')} intro={t('catch.intro')}>
      <CatchBody />
    </AdminPage>
  );
}

function tomorrowOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
}

function CatchBody() {
  const { t } = useT('admin');
  const data = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet('/api/admin/catch', adminCatchResponseSchema),
    retry: false,
  });
  if (data.isPending) {
    return (
      <p role="status" className="t-body text-text-muted">
        {t('access.loading')}
      </p>
    );
  }
  if (!data.data) {
    return (
      <p role="alert" className="t-body text-danger">
        {t('errors.load')}
      </p>
    );
  }
  return <CatchEditor data={data.data} />;
}

interface Item {
  species: string;
  port: string;
  arrivedAt: string;
}

function CatchEditor({ data }: { data: AdminCatchResponse }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const dateTime = useDateTime();
  const client = useQueryClient();
  const tomorrow = tomorrowOf(data.today);
  const [date, setDate] = useState(data.today);
  const boardFor = (day: string) => data.boards.find((board) => board.date === day);
  const [items, setItems] = useState<Item[]>(() => {
    const board = boardFor(data.today);
    return board && board.items.length > 0 ? board.items : [{ species: '', port: '', arrivedAt: '06:00' }];
  });
  const [notice, setNotice] = useState<NoticeState>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const current = boardFor(date);

  const save = useMutation({
    mutationFn: (publish: boolean) =>
      apiSend('PUT', '/api/admin/catch', { date, items, publish }, adminCatchResponseSchema),
    onSuccess: (_result, publish) => {
      setFields({});
      setNotice({ tone: 'ok', text: publish ? t('catch.published') : t('catch.saved') });
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setFields(fieldErrorsOf(error));
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });

  function changeDate(day: string) {
    setDate(day);
    const board = boardFor(day);
    setItems(board && board.items.length > 0 ? board.items : [{ species: '', port: '', arrivedAt: '06:00' }]);
  }

  return (
    <div className="flex flex-col gap-6">
      <SelectField
        id="catch-date"
        label={t('catch.date')}
        value={date}
        onChange={(event) => {
          changeDate(event.target.value);
        }}
      >
        <option value={data.today}>{t('catch.today', { date: data.today })}</option>
        <option value={tomorrow}>{t('catch.tomorrow', { date: tomorrow })}</option>
      </SelectField>
      <p className="t-body">
        {current?.publishedAt
          ? t('catch.statusPublished', { time: dateTime(current.publishedAt) })
          : current
            ? t('catch.statusDraft')
            : t('catch.statusNone')}
      </p>
      <Notice notice={notice} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          save.mutate(true);
        }}
        className="flex flex-col gap-5"
      >
        <ol className="flex flex-col gap-4">
          {items.map((item, index) => {
            const update = (changes: Partial<Item>) => {
              const next = [...items];
              next[index] = { ...item, ...changes };
              setItems(next);
            };
            const id = `catch-${String(index)}`;
            return (
              <li
                key={id}
                className="grid gap-3 border-b border-border pb-4 md:grid-cols-[1fr_1fr_10rem_auto] md:items-end"
              >
                <TextField
                  id={`${id}-species`}
                  label={t('catch.species', { n: index + 1 })}
                  value={item.species}
                  translate="no"
                  error={fieldMessage(fields[`items.${String(index)}.species`])}
                  onChange={(event) => {
                    update({ species: event.target.value });
                  }}
                />
                <TextField
                  id={`${id}-port`}
                  label={t('catch.port', { n: index + 1 })}
                  value={item.port}
                  translate="no"
                  error={fieldMessage(fields[`items.${String(index)}.port`])}
                  onChange={(event) => {
                    update({ port: event.target.value });
                  }}
                />
                <TextField
                  id={`${id}-time`}
                  type="time"
                  label={t('catch.arrivedAt', { n: index + 1 })}
                  value={item.arrivedAt}
                  error={fieldMessage(fields[`items.${String(index)}.arrivedAt`])}
                  onChange={(event) => {
                    update({ arrivedAt: event.target.value });
                  }}
                />
                <Button
                  variant="text"
                  {...(items.length === 1 ? { disabledReason: t('catch.lastItem') } : {})}
                  onClick={() => {
                    setItems(items.filter((_, i) => i !== index));
                  }}
                >
                  {t('catch.remove', { n: index + 1 })}
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            {...(items.length >= 12 ? { disabledReason: t('catch.max') } : {})}
            onClick={() => {
              setItems([...items, { species: '', port: '', arrivedAt: '06:00' }]);
            }}
          >
            {t('catch.add')}
          </Button>
          {/* Una pizarra ya publicada se corrige publicándola de nuevo: guardarla cambia la portada. */}
          {current?.publishedAt ? null : (
            <Button
              variant="secondary"
              loading={save.isPending && !save.variables}
              onClick={() => {
                setNotice(null);
                save.mutate(false);
              }}
            >
              {t('catch.saveDraft')}
            </Button>
          )}
          <Button type="submit" loading={save.isPending && save.variables}>
            {current?.publishedAt ? t('catch.publishChanges') : t('catch.publish')}
          </Button>
        </div>
      </form>
    </div>
  );
}
