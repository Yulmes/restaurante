import { type RouteConfig, index, route } from '@react-router/dev/routes';

// es-CR sin prefijo, inglés con /en (§4.2). En M1 solo existen la portada
// provisional y la página interna del sistema de diseño.
export default [
  index('routes/inicio.tsx', { id: 'inicio-es' }),
  route('_design', 'routes/design.tsx', { id: 'design-es' }),
  route('en', 'routes/inicio.tsx', { id: 'inicio-en' }),
  route('en/_design', 'routes/design.tsx', { id: 'design-en' }),
] satisfies RouteConfig;
