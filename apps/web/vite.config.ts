import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    // En desarrollo la web y la API comparten origen, como en producción con el Worker (§4.1, §5).
    // `API_PROXY_TARGET` permite apuntar a otra API (las E2E de identidad usan una aparte).
    proxy: {
      '/api': { target: process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
