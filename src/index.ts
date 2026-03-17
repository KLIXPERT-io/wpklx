#!/usr/bin/env bun

import pkg from "../package.json";
import { extractProfile, parseArgs } from "./cli/parser.ts";
import { loadEnvConfig } from "./config/env.ts";
import { resolveConfig } from "./config/settings.ts";
import { logger } from "./helpers/logger.ts";
import { handleError } from "./helpers/error.ts";
import { resolveStdin } from "./helpers/stdin.ts";
import { setNoColor } from "./cli/output.ts";
import { runDiscover, runRoutes, runConfig, getSchema, executeCommand } from "./cli/commands.ts";
import { showGlobalHelp, showResourceHelp } from "./cli/help.ts";
import { runLogin } from "./cli/login.ts";
import { runSerialize } from "./cli/serialize.ts";
import { runMarkdown } from "./cli/markdown.ts";
import { safeExit } from "./helpers/exit.ts";

const version: string = pkg.version;

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Handle version early (before config resolution)
  if (
    rawArgs.includes("--version") ||
    rawArgs.includes("-v") ||
    rawArgs[0] === "version"
  ) {
    console.log(`wpklx v${version}`);
    await safeExit(0);
  }

  // Handle global help early (before config/stdin resolution)
  if (
    rawArgs.includes("--help") ||
    rawArgs.includes("-h") ||
    rawArgs[0] === "help" ||
    rawArgs.length === 0
  ) {
    // If it's just --help or "help" with no resource, show global help
    const nonFlagArgs = rawArgs.filter((a) => !a.startsWith("-") && !a.startsWith("@"));
    if (nonFlagArgs.length === 0 || nonFlagArgs[0] === "help") {
      setNoColor(rawArgs.includes("--no-color"));
      showGlobalHelp(version);
      await safeExit(0);
    }
  }

  // Handle login early (before config resolution — no config needed)
  if (rawArgs[0] === "login") {
    await runLogin();
    await safeExit(0);
  }

  // Handle serialize early (no config needed — local utility command)
  if (rawArgs[0] === "serialize") {
    await runSerialize(rawArgs.slice(1));
    await safeExit(0);
  }

  // Handle markdown early (no config needed — local utility command)
  if (rawArgs[0] === "markdown") {
    await runMarkdown(rawArgs.slice(1));
    await safeExit(0);
  }

  // Extract @profile and parse arguments
  const { profileName, profile, remainingArgs } = extractProfile(rawArgs);
  const parsed = parseArgs(remainingArgs);

  // Configure logger and output
  logger.configure({
    verbose: parsed.globalFlags.verbose,
    quiet: parsed.globalFlags.quiet,
    noColor: parsed.globalFlags.no_color,
  });
  setNoColor(parsed.globalFlags.no_color === true);

  // Resolve stdin if --flag - was used
  await resolveStdin(parsed);

  // Load env config
  const envConfig = loadEnvConfig(parsed.globalFlags.env);

  // Handle global help (no resource or explicit help command)
  if (
    (parsed.globalFlags.help && !parsed.resource) ||
    parsed.resource === "help"
  ) {
    showGlobalHelp(version);
    await safeExit(0);
  }

  // Handle resource-specific help
  if (parsed.action === "help" || (parsed.globalFlags.help && parsed.resource)) {
    // Need config to discover schema for resource help
    try {
      const config = resolveConfig({
        cliFlags: parsed.globalFlags,
        envConfig,
        yamlProfile: profile,
        profileName,
      });
      const commands = await getSchema(config);
      showResourceHelp(parsed.resource, commands);
    } catch {
      // If config fails, show generic help
      console.log(`Help for '${parsed.resource}' requires a configured WordPress site.`);
      console.log(`Run 'wpklx config add <name>' to set up a profile first.`);
    }
    await safeExit(0);
  }

  // For built-in commands that need config, resolve it now
  if (parsed.resource === "discover" || parsed.resource === "routes") {
    const config = resolveConfig({
      cliFlags: parsed.globalFlags,
      envConfig,
      yamlProfile: profile,
      profileName,
    });

    if (parsed.resource === "discover") {
      await runDiscover(config);
      await safeExit(0);
    }

    if (parsed.resource === "routes") {
      await runRoutes(config, parsed);
      await safeExit(0);
    }
  }

  // Config commands don't need API credentials
  if (parsed.resource === "config") {
    await runConfig(parsed);
    await safeExit(0);
  }

  // No resource specified
  if (!parsed.resource) {
    showGlobalHelp(version);
    await safeExit(0);
  }

  // Dynamic resource commands need full config
  const config = resolveConfig({
    cliFlags: parsed.globalFlags,
    envConfig,
    yamlProfile: profile,
    profileName,
  });

  // Execute dynamic resource command
  await executeCommand(config, parsed);
}

main().catch(handleError);
