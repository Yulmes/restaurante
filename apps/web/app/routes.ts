import { type RouteConfig, index, route } from '@react-router/dev/routes';

// es-CR sin prefijo, inglés con /en y segmentos traducidos (§4.2). M1: portada provisional y
// sistema de diseño. M3: páginas de la cuenta, fuera del prerender y con noindex (§4.2).
const ACCOUNT = [
  ['cuenta/ingresar', 'en/account/sign-in', 'routes/cuenta/ingresar.tsx', 'ingresar'],
  ['cuenta/registro', 'en/account/register', 'routes/cuenta/registro.tsx', 'registro'],
  ['cuenta/verificar', 'en/account/verify', 'routes/cuenta/verificar.tsx', 'verificar'],
  ['cuenta/recuperar', 'en/account/forgot-password', 'routes/cuenta/recuperar.tsx', 'recuperar'],
  ['cuenta/restablecer', 'en/account/reset-password', 'routes/cuenta/restablecer.tsx', 'restablecer'],
  ['cuenta', 'en/account', 'routes/cuenta/perfil.tsx', 'perfil'],
] as const;

export default [
  index('routes/inicio.tsx', { id: 'inicio-es' }),
  route('_design', 'routes/design.tsx', { id: 'design-es' }),
  route('en', 'routes/inicio.tsx', { id: 'inicio-en' }),
  route('en/_design', 'routes/design.tsx', { id: 'design-en' }),
  ...ACCOUNT.flatMap(([es, en, file, id]) => [
    route(es, file, { id: `${id}-es` }),
    route(en, file, { id: `${id}-en` }),
  ]),
] satisfies RouteConfig;
