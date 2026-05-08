// Runs at bin entry, BEFORE the main CLI module is loaded. Must compile to
// syntax that parses on Node 14+ — the shim's whole job is surfacing a
// friendly diagnostic when an old runtime can't load the bundled CLI.

const REQUIRED_MAJOR = 20;

export type NodeVersionCheckResult =
  | { ok: true }
  | { ok: false; message: string };

export function checkNodeVersion(args: {
  versionString: string;
  execPath: string;
}): NodeVersionCheckResult {
  const head = args.versionString.split('.')[0] ?? '';
  const major = parseInt(head, 10);
  if (Number.isNaN(major) || major < REQUIRED_MAJOR) {
    return {
      ok: false,
      message:
        `marmot requires Node >=${REQUIRED_MAJOR}.\n` +
        `You're running Node v${args.versionString} from ${args.execPath}.\n\n` +
        `If you have a newer Node installed (e.g. via nvm), your shell may not be\n` +
        `loading it. Check your PATH and try \`node --version\`.`,
    };
  }
  return { ok: true };
}
