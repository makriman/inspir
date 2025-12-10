/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'deep-blue': '#1A237E',
        'vibrant-yellow': '#C6FF00',
        'coral-red': '#FF5252',
        'off-white': '#F5F5F5',
        'purple-dark': '#6A1B9A',
        'purple-darker': '#4A148C',
      },
      backgroundImage: {
        'purple-gradient': 'linear-gradient(135deg, #6A1B9A 0%, #4A148C 100%)',
      },
      fontFamily: {
        sans: ['Montserrat', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        fadeIn: 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
