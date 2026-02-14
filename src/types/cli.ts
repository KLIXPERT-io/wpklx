/** Global flags applicable to all commands */
export interface GlobalFlags {
  format?: string;
  fields?: string;
  per_page?: number;
  page?: number;
  quiet?: boolean;
  verbose?: boolean;
  no_color?: boolean;
  help?: boolean;
  version?: boolean;
  env?: string;
  serialize?: boolean;
  markdown?: boolean;
  no_h1?: boolean;
}

/** Parsed CLI arguments after argument processing */
export interface ParsedArgs {
  resource: string;
  action: string;
  id?: string;
  namespacePrefix?: string;
  options: Record<string, string | boolean>;
  globalFlags: GlobalFlags;
  stdinFlag?: string;
  stdinData?: Buffer;
}

/** Metadata for a single CLI command derived from API schema */
export interface Command {
  resource: string;
  action: string;
  method: string;
  path: string;
  params: CommandParam[];
}

/** Parameter metadata for a command */
export interface CommandParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
}
