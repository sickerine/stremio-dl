import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  dts: true,
  sourcemap: true,
});
