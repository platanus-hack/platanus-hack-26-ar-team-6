#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createElectronViteArgs,
  createElectronViteEnv,
} from "./electron-vite-env.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const electronViteBin = resolve(
  currentDir,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-vite.cmd" : "electron-vite",
);

const child = spawn(
  electronViteBin,
  createElectronViteArgs(process.argv.slice(2)),
  {
    env: createElectronViteEnv(),
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
