import { defineConfig } from "vitest/config";

export default defineConfig({
  clearScreen: false,
  server: {
    strictPort: true,
  },
  test: {
    environment: "node",
  },
});
