import { i18n } from '../i18n/config.ts';
import { localeFromPathname } from '../i18n/locale.ts';

type MetaKey =
  | 'signIn.metaTitle'
  | 'register.metaTitle'
  | 'verify.metaTitle'
  | 'forgot.metaTitle'
  | 'reset.metaTitle'
  | 'profile.metaTitle';

/** Las páginas de la cuenta no se indexan (§4.2: `/cuenta/*` usa el fallback SPA con noindex). */
export function accountMeta(pathname: string, key: MetaKey) {
  const t = i18n.getFixedT(localeFromPathname(pathname), 'account');
  return [{ title: t(key) }, { name: 'robots', content: 'noindex' }];
}
