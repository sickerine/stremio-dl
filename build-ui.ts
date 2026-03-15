import { build } from "bun";

const result = await build({
  entrypoints: ["src/ui/index.tsx"],
  outdir: "src/ui/dist",
  target: "browser",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // Bun reads JSX config from src/ui/tsconfig.json (jsxImportSource: "preact")
});

if (!result.success) {
  console.error("UI build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("UI bundle built → src/ui/dist/index.js");
