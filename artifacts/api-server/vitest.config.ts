import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
  resolve: {
    alias: {
      "@workspace/db": path.resolve(import.meta.dirname, "../../lib/db/src/index.ts"),
    },
    conditions: ["node", "import", "default"],
  },
  define: {
    "import.meta.env.BASE_URL": JSON.stringify("/driver/"),
  },
});
