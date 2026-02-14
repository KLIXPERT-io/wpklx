#!/usr/bin/env bun

import pkg from "../package.json";
import { extractProfile, parseArgs } from "./cli/parser.ts";
import { loadEnvConfig } from "./config/env.ts";
import { resolveConfig } from "./config/settings.ts";
import { logger } from "./helpers/logger.ts";
import { handleError } from "./helpers/error.ts";
import { setNoColor } from "./cli/output.ts";
import { runDiscover, runRoutes, runConfig, getSchema } from "./cli/commands.ts";
import { showGlobalHelp, showResourceHelp } from "./cli/help.ts";

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

  // TODO: implement dynamic CRUD in US-025
  logger.info(`Would execute: ${parsed.resource} ${parsed.action}`);
  logger.debug(`Config: ${JSON.stringify({ ...config, application_password: "****" })}`);
}

main().catch(handleError);
