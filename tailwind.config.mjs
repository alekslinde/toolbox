/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts}'],
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
