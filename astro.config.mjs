import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// wawoff2's compress_binding.js and decompress_binding.js only set
// module.exports inside an ENVIRONMENT_IS_NODE guard. In browser production
// builds (Rollup) that guard is false, so Rollup's CJS wrapper gets an empty
// {} instead of the Emscripten Module object. The result: compress.js's
// runtimeInit Promise resolves against the wrong object and never fires.
// Fix: append an unconditional module.exports assignment so Rollup always
// gets the correct Module regardless of environment.
const wawoff2BindingFix = {
  name: 'wawoff2-binding-exports-fix',
  enforce: 'pre',
  transform(code, id) {
    if (/wawoff2\/build\/(compress|decompress)_binding\.js$/.test(id)) {
      return { code: code + '\nif(typeof module!=="undefined"){module["exports"]=Module;}', map: null };
    }
  },
};

export default defineConfig({
  site: 'https://lindetoolbox.com',
  redirects: {
    '/tools/token-defluffer': '/',
  },
  vite: {
    plugins: [tailwindcss(), wawoff2BindingFix],
    optimizeDeps: {
      include: ['alpinejs', 'wawoff2/decompress', 'wawoff2/compress'],
    },
  },
});
