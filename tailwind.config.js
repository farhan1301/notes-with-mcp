module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#d99a00', soft: '#fff4d1', dark: '#f5c242' },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
