/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        carbon: {
          950: '#090a0c',
          900: '#101216',
          850: '#151820',
          800: '#1b2029',
          700: '#242b36',
        },
        apex: {
          500: '#ff3b30',
          400: '#ff665d',
          300: '#ff9b6a',
        },
        circuit: {
          500: '#18c7b7',
          400: '#3ee7d4',
        },
        lime: {
          400: '#b7f34b',
        },
      },
      fontFamily: {
        sans: ['"SF Pro Text"', '"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 18px 54px rgba(0, 0, 0, 0.42)',
        glow: '0 0 36px rgba(24, 199, 183, 0.18)',
      },
    },
  },
  plugins: [],
};
