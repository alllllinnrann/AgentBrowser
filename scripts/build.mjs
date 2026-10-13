import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/main/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/main.cjs",
    external: ["electron", "node:sqlite"],
  }),
  build({
    entryPoints: ["src/main/preload.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/preload.cjs",
    external: ["electron"],
  }),
  build({
    entryPoints: ["src/renderer/app.tsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: "dist/app.js",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
  }),
]);
await copyFile("src/renderer/index.html", "dist/index.html");
