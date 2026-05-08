/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts}'],
  safelist: [
    // color-namer: runtime className assembly in render()
    'text-white/70',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:   ['"DM Sans"', 'sans-serif'],
        serif:  ['"DM Serif Display"', 'serif'],
        mono:   ['"DM Mono"', 'monospace'],
        script: ['Caveat', 'cursive'],
      },
      colors: {
        sidebar: '#1a1d23',
      },
    },
  },
};
