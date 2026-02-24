/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.html", "./public/assets/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        primary: "#76B900",
        surface: "#0F1218",
        soft: "#A1AAB8"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(118,185,0,0.35), 0 20px 60px rgba(118,185,0,0.2)"
      }
    }
  },
  plugins: []
};