/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary-blue': '#1A237E',      // Deep Blue - primary brand color
        'deep-blue': '#1A237E',         // Alias for backwards compatibility
        'accent-yellow': '#C6FF00',     // Vibrant Yellow-Green
        'vibrant-yellow': '#C6FF00',    // Alias for backwards compatibility
        'accent-red': '#FF5252',        // Coral Red
        'coral-red': '#FF5252',         // Alias for backwards compatibility
        'off-white': '#F5F5F5',         // Backgrounds and cards
        'purple-light': '#6A1B9A',      // Purple gradient light
        'purple-dark': '#4A148C',       // Purple gradient dark
        'purple-darker': '#4A148C',     // Alias for backwards compatibility
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
