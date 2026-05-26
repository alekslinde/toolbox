import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://lindetoolbox.com',
  redirects: {
    '/tools/token-defluffer': '/',
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['alpinejs', 'wawoff2/decompress', 'wawoff2/compress'],
    },
  },
});
