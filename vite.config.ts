/**
 * @file Vite build configuration
 *
 * ライブラリ (src/index.ts) と MCP サーバー CLI (src/mcp/serve.ts) の
 * 2 エントリポイントをビルドする。
 */

import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const EXTERNAL = [
  /node:.+/,
  "playwright",
  "chrome-remote-interface",
  /^@modelcontextprotocol\/sdk\/.+/,
];

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
      entry: {
        index: "src/index.ts",
        "mcp-serve": "src/mcp/serve.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: EXTERNAL,
    },
  },
});
