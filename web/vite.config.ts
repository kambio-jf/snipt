import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // dev-only: same-origin in prod behind Nginx, so no CORS to think about there
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
