// Capacitor expects dist-mobile/index.html as the entry file.
// Vite emits index.mobile.html (matching the source filename) because
// index.mobile.html is a separate, additive entry point kept alongside
// the existing index.html so the web build stays untouched.
import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(import.meta.dirname, "..", "dist-mobile");
const from = resolve(outDir, "index.mobile.html");
const to = resolve(outDir, "index.html");

if (existsSync(from)) {
  renameSync(from, to);
  console.log("[postbuild-mobile] index.mobile.html -> index.html");
} else if (!existsSync(to)) {
  throw new Error(`[postbuild-mobile] Expected ${from} to exist after build`);
}
