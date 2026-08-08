/**
 * Test runner.
 *
 * `node --test` cannot find these files on its own. Passed a directory it only
 * matches JavaScript extensions, and the glob patterns that would match
 * `*.test.ts` did not land until Node 21 — below this project's floor of 20.9.
 * A shell glob in the npm script would cover both, but only on a shell that
 * expands it, which rules out Windows.
 *
 * So we enumerate the files here and hand Node an explicit list. `tsx` is
 * loaded as the TypeScript loader and resolves the `@/*` alias from
 * tsconfig.json, which the modules under test import each other through.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, "tests");

function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(full));
    else if (entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found.sort();
}

const files = collect(testsDir);
if (files.length === 0) {
  console.error(`No *.test.ts files under ${testsDir}.`);
  process.exit(1);
}

// Anything after `--` goes to node, so `npm test -- --test-name-pattern=cursor`
// and friends keep working.
const passthrough = process.argv.slice(2);

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "--test-reporter=spec", ...passthrough, ...files],
  { stdio: "inherit", cwd: root }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
