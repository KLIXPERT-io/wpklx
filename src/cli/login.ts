import * as readline from "node:readline";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

function style(text: string, code: string): string {
  return `${code}${text}${ANSI.reset}`;
}

/** Prompt for input with a default value. Returns trimmed string. */
function promptInput(question: string, defaultValue?: string): string {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = prompt(`${question}${suffix}:`);
  const value = answer?.trim() || defaultValue || "";
  return value;
}

/** Prompt for a password with masked input (characters hidden). */
function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Mute stdout to hide typed characters
    const originalWrite = process.stdout.write.bind(process.stdout);
    let muted = false;

    process.stdout.write = ((
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      if (muted) {
        return true;
      }
      if (typeof encodingOrCb === "function") {
        return originalWrite(chunk, encodingOrCb);
      }
      return originalWrite(chunk, encodingOrCb, cb);
    }) as typeof process.stdout.write;

    rl.question(`${question}: `, (answer) => {
      muted = false;
      process.stdout.write = originalWrite;
      console.log(); // newline after hidden input
      rl.close();
      resolve(answer.trim());
    });

    muted = true;
  });
}

/** Normalize a host URL: add https:// if no scheme, strip trailing slashes. */
export function normalizeHost(input: string): string {
  let url = input.trim();
  if (!url) return url;

  // Add https:// if no scheme present
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  // Strip trailing slashes
  url = url.replace(/\/+$/, "");

  return url;
}

export interface LoginCredentials {
  host: string;
  username: string;
  applicationPassword: string;
  profileName: string;
}

/**
 * Interactive login command — guides users through WordPress site setup.
 * Collects host, username, application password, and profile name.
 */
export async function runLogin(): Promise<void> {
  console.log(
    style("\nwpklx login", ANSI.bold) +
      " — Interactive WordPress site setup\n",
  );

  const credentials = await collectCredentials();

  // Placeholder for US-003+ (validation, saving, etc.)
  console.log(
    `\n${style("Collected:", ANSI.dim)} host=${credentials.host}, user=${credentials.username}, profile=${credentials.profileName}`,
  );
}

/** Collect all credentials via interactive prompts. */
export async function collectCredentials(): Promise<LoginCredentials> {
  // 1. WordPress site URL
  const rawHost = promptInput(
    "WordPress site URL (e.g., example.com)",
  );
  if (!rawHost) {
    console.error("Host URL is required.");
    process.exit(1);
  }
  const host = normalizeHost(rawHost);

  // 2. Show application password URL
  const appPasswordUrl = `${host}/wp-admin/authorize-application.php`;
  console.log(
    `\n${style("Create an application password at:", ANSI.dim)}`,
  );
  console.log(style(`  ${appPasswordUrl}`, ANSI.cyan));
  console.log();

  // 3. Username
  const username = promptInput("WordPress username");
  if (!username) {
    console.error("Username is required.");
    process.exit(1);
  }

  // 4. Application password (masked input, strip whitespace)
  const rawPassword = await promptPassword("Application password");
  if (!rawPassword) {
    console.error("Application password is required.");
    process.exit(1);
  }
  // WordPress displays app passwords with spaces — strip them
  const applicationPassword = rawPassword.replace(/\s/g, "");

  // 5. Profile name
  const profileName = promptInput("Profile name", "default");

  return { host, username, applicationPassword, profileName };
}
