import { type RouteConfig, index, route } from '@react-router/dev/routes';

// es-CR sin prefijo, inglés con /en y segmentos traducidos (§4.2). Los slugs de categorías y
// platos son iguales en los dos idiomas (D2). M1: sistema de diseño. M3: cuenta (noindex, fuera
// del prerender). M4: páginas públicas prerenderizadas. M5: pedido (fuera del prerender). M7:
// historial, seguimiento, bandeja de demostración y Pase (fuera del prerender).
const PUBLIC = [
  ['carta', 'en/menu', 'routes/carta.tsx', 'carta'],
  ['carta/:categoria', 'en/menu/:categoria', 'routes/categoria.tsx', 'categoria'],
  ['carta/:categoria/:plato', 'en/menu/:categoria/:plato', 'routes/plato.tsx', 'plato'],
  ['nosotros', 'en/about', 'routes/nosotros.tsx', 'nosotros'],
  ['visitanos', 'en/visit', 'routes/visitanos.tsx', 'visitanos'],
] as const;

const ACCOUNT = [
  ['cuenta/ingresar', 'en/account/sign-in', 'routes/cuenta/ingresar.tsx', 'ingresar'],
  ['cuenta/registro', 'en/account/register', 'routes/cuenta/registro.tsx', 'registro'],
  ['cuenta/verificar', 'en/account/verify', 'routes/cuenta/verificar.tsx', 'verificar'],
  ['cuenta/recuperar', 'en/account/forgot-password', 'routes/cuenta/recuperar.tsx', 'recuperar'],
  ['cuenta/restablecer', 'en/account/reset-password', 'routes/cuenta/restablecer.tsx', 'restablecer'],
  ['cuenta', 'en/account', 'routes/cuenta/perfil.tsx', 'perfil'],
  // M7: historial y seguimiento de pedidos (D3) y bandeja de demostración (§8.5).
  ['cuenta/pedidos', 'en/account/orders', 'routes/cuenta/pedidos.tsx', 'pedidos'],
  ['cuenta/pedidos/:id', 'en/account/orders/:id', 'routes/cuenta/seguimiento.tsx', 'seguimiento'],
  ['cuenta/bandeja', 'en/account/inbox', 'routes/cuenta/bandeja.tsx', 'bandeja'],
] as const;

// M5: pedido (noindex, fuera del prerender, como la cuenta).
const ORDER = [
  ['pedido', 'en/order', 'routes/pedido/carrito.tsx', 'carrito'],
  ['pedido/finalizar', 'en/order/checkout', 'routes/pedido/finalizar.tsx', 'finalizar'],
  ['pedido/confirmacion/:id', 'en/order/confirmation/:id', 'routes/pedido/confirmacion.tsx', 'confirmacion'],
] as const;

// M7: el Pase de staff y admin (noindex, fuera del prerender). La protección real está en la API.
const ADMIN = [['admin/pase', 'en/admin/pass', 'routes/admin/pase.tsx', 'pase']] as const;

export default [
  index('routes/inicio.tsx', { id: 'inicio-es' }),
  route('en', 'routes/inicio.tsx', { id: 'inicio-en' }),
  route('_design', 'routes/design.tsx', { id: 'design-es' }),
  route('en/_design', 'routes/design.tsx', { id: 'design-en' }),
  ...[...PUBLIC, ...ACCOUNT, ...ORDER, ...ADMIN].flatMap(([es, en, file, id]) => [
    route(es, file, { id: `${id}-es` }),
    route(en, file, { id: `${id}-en` }),
  ]),
] satisfies RouteConfig;
