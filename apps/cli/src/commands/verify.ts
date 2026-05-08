import { Command } from 'commander';

import {
  AICliError,
  assertProviderEnabled,
  readMarmotConfig,
  resolveDataVerbDefaults,
  resolveProviderAuth,
  resolveRetryOptions,
  runWithRetries,
  withSpinner,
  type DataVerifyEmailInput,
  type StatusStream,
} from '@marmot-sh/core';

import {
  assertProviderSupportsCell,
  getDataProviderAdapter,
} from '../providers/data-index.js';
import { withResponseCache } from '../providers/cache-wrap.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';
import { writeEnvelope } from '../lib/data-verb-io.js';
import { withPreset } from '../lib/with-preset.js';
import { withUsageLogging } from '../lib/usage-recorder.js';

export type VerifyCommandOptions = {
  email?: string;
  provider?: string;
  apiKey?: string;
  raw?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  preset?: string;
  preset_id?: string;
};

export type VerifyCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleVerifyCommand(
  args: string[],
  options: VerifyCommandOptions,
  deps: VerifyCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  const email = (options.email ?? args[0])?.trim();
  if (!email) {
    throw new AICliError(
      'validation',
      'verify requires an email address. Pass it positionally or via --email.',
    );
  }

  const config = await readMarmotConfig(env);
  const { provider } = resolveDataVerbDefaults('verify', config, {
    provider: options.provider,
  });
  assertProviderSupportsCell('verify', 'email', provider);

  const adapter = getDataProviderAdapter(provider);
  if (!adapter.verifyEmail) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares verify.email support but the method is missing.`,
    );
  }

  assertProviderEnabled(provider, config);
  const { apiKey, apiSecret } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'verify', retries);
  const input: DataVerifyEmailInput = { email, apiKey, apiSecret, fetchFn };

  const { result, cached } = await withUsageLogging(
    config,
    {
      verb: 'verify',
      provider,
      preset_id: options.preset_id,
      flag_presence: { email: true },
      session: null,
      sensitive: { flags: { email } },
    },
    async () => {
      const out = await withSpinner(
        `Verifying email via ${provider}…`,
        () =>
          withResponseCache({
            provider,
            verb: 'verify.email',
            input: { email },
            query: email,
            config,
            env,
            noCache: options.cache === false,
            refresh: options.refresh,
            fetcher: () =>
              runWithRetries(
                (abortSignal) => adapter.verifyEmail!({ ...input, abortSignal }),
                { retries, timeoutMs, onRetry },
              ),
          }),
        { stream: stderr, env },
      );
      return {
        result: out.response,
        cached: out.cached,
        quantity: { calls: 1 },
        cost: null,
      };
    },
    env,
  );

  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'verify' as const,
    type: 'email' as const,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    usage: result.usage ?? null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope);
}

export function buildVerifyCommand(deps: VerifyCommandDependencies = {}): Command {
  const cmd = new Command('verify')
    .description('Verify email deliverability via a configured provider.')
    .argument('[email]', 'Email address to verify.')
    .option('--email <addr>', 'Email address (alternative to positional arg).')
    .option('--provider <slug>', 'Data provider: hunter, tomba, bouncer, datagma, zerobounce, kickbox.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--raw', "Emit the provider's native response under `raw` instead of normalized data.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('--preset <name>', 'Apply a saved verify preset as defaults (explicit flags still win). Shorthand: @name.')
    .action(async (emailArg: string | undefined, options: VerifyCommandOptions) => {
      const merged = await withPreset(options, 'verify');
      await handleVerifyCommand(emailArg ? [emailArg] : [], merged, deps);
    });
  return cmd;
}
