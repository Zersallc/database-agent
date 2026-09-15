/**
 * Eval runner wrapper — mirrors scripts/run-tests.mjs so `npm run eval --
 * --case=... --repeat=...` works the same way `npm test -- --test-name-pattern=...`
 * does. `tsx` resolves the `@/*` tsconfig alias evals/ imports the app through.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "evals", "run.ts");

const passthrough = process.argv.slice(2);

const child = spawn(process.execPath, ["--import", "tsx", entry, ...passthrough], {
  stdio: "inherit",
  cwd: root,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
