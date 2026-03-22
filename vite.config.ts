/**
 * @file Vite build configuration
 */

import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      exclude: ["**/*.spec.ts"],
    }),
  ],
  build: {
    outDir: "dist",
    lib: {
      entry: "src/index.ts",
      formats: ["cjs", "es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [/node:.+/],
    },
  },
});
