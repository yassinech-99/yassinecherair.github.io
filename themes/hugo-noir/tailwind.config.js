/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ["./layouts/**/*.html", "./content/**/*.{html,md}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Newsreader', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        'bg-primary-light': '#ebe7e4',
        'text-primary-light': '#252f3d',
        'text-secondary-light': '#5c5752',
        'border-primary-light': '#8b847d',
        'accent-light': '#4b607c',

        'bg-primary-dark': '#161d27',
        'bg-secondary-dark': '#212730',
        'bg-tertiary-dark': '#252f3d',
        'text-primary-dark': '#ebe7e4',
        'text-secondary-dark': '#9fa4ab',
        'border-primary-dark': '#495059',
        'accent-dark': '#6a9fcc',
      },
    },
  },
  plugins: [],
}
