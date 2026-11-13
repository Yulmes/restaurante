import type { Config } from '@react-router/dev/config';

// §4.2: modo framework sin servidor de renderizado. El prerender de las páginas
// públicas (carta, platos, SEO por idioma) se configura en M4; en M1 la app
// funciona como SPA y solo expone la página interna del sistema de diseño.
export default {
  appDirectory: 'app',
  ssr: false,
} satisfies Config;
