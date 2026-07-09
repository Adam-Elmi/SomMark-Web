import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/variables/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  minify: true,
  external: ["vite", "sommark", "ora", "picocolors", "shiki"],
});
