import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://lindetoolbox.com',
  redirects: {
    '/tools/token-defluffer': '/',
  },
  integrations: [tailwind()],
  vite: {
    optimizeDeps: {
      include: ['alpinejs'],
    },
  },
});
