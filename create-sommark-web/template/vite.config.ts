import { defineConfig } from "vite";
import sommarkWeb from "sommark-web";

export default defineConfig({
  plugins: [
    sommarkWeb(),
  ],
  server: {
    host: true
  }
});
