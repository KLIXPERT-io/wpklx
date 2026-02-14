#!/usr/bin/env bun

import pkg from "../package.json";

const version: string = pkg.version;

const args = process.argv.slice(2);

if (
  args.includes("--version") ||
  args.includes("-v") ||
  args[0] === "version"
) {
  console.log(`wpklx v${version}`);
  process.exit(0);
}

console.log(`wpklx v${version}`);
