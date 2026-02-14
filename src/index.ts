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
    process.exit(0);
  }

  // Handle login early (before config resolution — no config needed)
  if (rawArgs[0] === "login") {
    await runLogin();
    process.exit(0);
  }

  // Handle serialize early (no config needed — local utility command)
  if (rawArgs[0] === "serialize") {
    await runSerialize(rawArgs.slice(1));
    process.exit(0);
  }

  // Handle markdown early (no config needed — local utility command)
  if (rawArgs[0] === "markdown") {
    await runMarkdown(rawArgs.slice(1));
    process.exit(0);
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
    process.exit(0);
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
    process.exit(0);
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
      process.exit(0);
    }

    if (parsed.resource === "routes") {
      await runRoutes(config, parsed);
      process.exit(0);
    }
  }

  // Config commands don't need API credentials
  if (parsed.resource === "config") {
    await runConfig(parsed);
    process.exit(0);
  }

  // No resource specified
  if (!parsed.resource) {
    showGlobalHelp(version);
    process.exit(0);
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
