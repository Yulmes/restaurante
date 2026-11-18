import type { Config } from '@react-router/dev/config';
import { catalogApiBase, fetchCatalogForBuild, publicPaths } from './app/site/public-paths.ts';

// §4.2: modo framework sin servidor de renderizado (`ssr: false`) + prerender de las páginas
// públicas en los dos idiomas. Las rutas dinámicas (categorías y platos) salen de la API pública
// del catálogo en el build (`CATALOG_API_URL`). El resto (cuenta, sistema de diseño) usa el
// fallback SPA.
export default {
  appDirectory: 'app',
  ssr: false,
  async prerender() {
    const paths = publicPaths(await fetchCatalogForBuild(catalogApiBase()));
    return paths.flatMap((path) => [path.es, path.en]);
  },
} satisfies Config;
