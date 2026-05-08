import { Command, Option } from 'commander';
import ansis from 'ansis';

import { handleAboutCommand } from './commands/about.js';
import { handleCompletionsCommand } from './commands/completions.js';
import { handleCacheRefreshCommand } from './commands/cache-refresh.js';
import {
  handleCacheClearCommand,
  handleCacheStatsCommand,
} from './commands/cache-responses.js';
import { buildAnswerCommand } from './commands/answer.js';
import { buildCrawlCommand } from './commands/crawl.js';
import { buildEnrichCommand } from './commands/enrich.js';
import { buildFindallCommand } from './commands/findall.js';
import { buildGetCommand } from './commands/get.js';
import { buildLookupCommand } from './commands/lookup.js';
import { buildMapCommand } from './commands/map.js';
import { buildResearchCommand } from './commands/research.js';
import { buildScrapeCommand } from './commands/scrape.js';
import { buildDoctorCommand } from './commands/doctor.js';
import { buildSearchCommand } from './commands/search.js';
import { buildUsageCommand } from './commands/usage.js';
import { buildTasksCommand } from './commands/tasks/index.js';
import { buildVerifyCommand } from './commands/verify.js';
import { buildApiCommand } from './commands/api.js';
import {
  handleConfigInit,
  handleConfigPath,
  handleConfigSet,
  handleConfigShow,
  handleConfigUnset,
} from './commands/config.js';
import {
  handleModelsCommand,
  type ModelsCommandOptions,
} from './commands/models.js';
import { handleProvidersListCommand } from './commands/providers-list.js';
import {
  handleSpeechRunCommand,
  type SpeechRunCommandOptions,
} from './commands/run-speak.js';
import {
  handleTranscribeRunCommand,
  type TranscribeRunCommandOptions,
} from './commands/run-transcribe.js';
import {
  handleVideoRunCommand,
  type VideoRunCommandOptions,
} from './commands/run-video.js';
import {
  handlePresetCreate,
  handlePresetDelete,
  handlePresetList,
  handlePresetRename,
  handlePresetShow,
  handlePresetUpdate,
  type PresetWriteOptions,
} from './commands/preset/index.js';
import {
  handleSessionCompact,
  handleSessionContext,
  handleSessionCreate,
  handleSessionCurrent,
  handleSessionDelete,
  handleSessionEnd,
  handleSessionExport,
  handleSessionFork,
  handleSessionList,
  handleSessionLog,
  handleSessionMark,
  handleSessionReset,
  handleSessionShow,
  handleSessionStats,
  handleSessionTail,
  handleSessionUse,
  type SessionCompactOptions,
  type SessionCreateOptions,
  type SessionDeleteOptions,
  type SessionExportOptions,
  type SessionLogOptions,
} from './commands/session/index.js';
import { handleSetupCommand } from './commands/setup.js';
import {
  handleImageRunCommand,
  type ImageRunCommandOptions,
} from './commands/run-image.js';
import {
  handleRunCommand,
  handleStreamRunCommand,
  type RunCommandOptions,
} from './commands/run.js';
import { readFileSync } from 'node:fs';

import {
  PRESET_NAME_REGEX,
  formatCliError,
  formatCliErrorJson,
  getExitCode,
  getMarmotConfigPath,
  type PresetMode,
} from '@marmot-sh/core';
import { withPreset } from './lib/with-preset.js';

function collectImage(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function collectFile(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function collectStop(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function collectProviderOption(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function addRunOptions(command: Command): Command {
  return command
    .option('--provider <provider>', 'Provider slug.')
    .option('--model <model>', 'Model slug.')
    .option('--api-key <apiKey>', 'Provider API key override (OpenRouter, Anthropic, OpenAI).')
    .option('--schema <jsonSchema>', 'Inline JSON Schema string for structured object output.')
    .option('--schema-file <schemaFile>', 'Read JSON Schema from a file for structured object output.')
    .option('--schema-module <schemaModule>', 'Load a Zod schema from a local TS/JS module. The file is executed with full Node privileges — only point this at code you trust.')
    .option('--system <systemPrompt>', 'System prompt text.')
    .option('--system-file <systemFile>', 'Read system prompt text from a file.')
    .option('-o, --output <outputFile>', 'Write rendered output to a file.')
    .option('-p, --prompt-file <promptFile>', 'Read prompt text from a file.')
    .option(
      '--image <path>',
      'Image file path or "-" for stdin (vision input). Repeatable.',
      collectImage,
      [] as string[],
    )
    .option('--image-mime <mime>', 'Override mime type when --image - is piped.')
    .option(
      '--file <path>',
      'File path or "-" for stdin (PDF or other document input). Repeatable.',
      collectFile,
      [] as string[],
    )
    .option('--file-mime <mime>', 'Override mime type when --file - is piped.')
    .option('--text-stdin', 'Force stdin to be read as text even if it looks like binary content.')
    .option('--temperature <n>', 'Sampling temperature (provider-specific range, typically 0–2).')
    .option('--max-tokens <n>', 'Hard cap on completion tokens.')
    .option('--top-p <n>', 'Top-p / nucleus sampling (0–1).')
    .option('--seed <n>', 'Reproducibility seed.')
    .option('--stop <text>', 'Stop sequence. Repeatable.', collectStop, [] as string[])
    .option('--reasoning <effort>', 'Thinking/reasoning effort: low | medium | high. Maps to Anthropic thinking budget, OpenAI reasoning_effort, OpenRouter reasoning.effort.')
    .option('--provider-option <key=value>', 'Generic passthrough (repeatable). Lands in providerOptions[<provider>] for niche params.', collectProviderOption, [] as string[])
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt generation timeout in seconds (default: 120).')
    .option('--stream', 'Stream text output and imply text mode.')
    .option('--text', 'Print only the generated text (no JSON envelope).')
    .option('--json', 'Print structured JSON output (default).')
    .option('--preset <name>', 'Apply a saved preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session for logging (overrides current-session pointer).');
}

function addPresetWriteOptions(command: Command): Command {
  return command
    // Shared
    .option('--provider <provider>', 'Provider slug.')
    .option('--model <model>', 'Model slug.')
    .option('--retries <count>', 'Default retry count for this preset.')
    .option('--timeout <seconds>', 'Default per-attempt timeout for this preset.')
    // Text
    .option('--system <text>', 'System prompt (text mode).')
    .option('--system-file <path>', 'System prompt from a file (text mode).')
    .option('--schema <json>', 'Inline JSON Schema string for structured output (text mode).')
    .option('--schema-file <path>', 'JSON Schema from a file (text mode).')
    .option('--schema-module <path>', 'TS/JS module exporting a Zod schema as default or `schema` (text mode). Trusted-code only.')
    .option('--temperature <n>', 'Sampling temperature (text mode).')
    .option('--max-tokens <n>', 'Hard cap on completion tokens (text mode).')
    .option('--top-p <n>', 'Top-p / nucleus sampling 0–1 (text mode).')
    .option('--seed <n>', 'Reproducibility seed (text/image mode).')
    .option('--stop <text>', 'Stop sequence. Repeatable. (text mode).', collectStop, [] as string[])
    .option('--reasoning <effort>', 'Thinking/reasoning effort: low|medium|high (text mode).')
    .option('--provider-option <key=value>', 'Generic passthrough. Repeatable. (text/image/speech/transcription mode).', collectProviderOption, [] as string[])
    .option('--stream', 'Default to streaming text output (text mode).')
    .option('--json', 'Default to JSON envelope output (text mode).')
    // Image
    .option('--size <WxH>', 'Image size (image mode).')
    .option('--quality <level>', 'Image quality (image mode).')
    .option('--style <style>', 'Image style (image mode).')
    .option('--negative <prompt>', 'Negative prompt (image mode).')
    .option('--n <count>', 'Number of images (image mode).')
    // Speech
    .option('--voice <voice>', 'Voice id (speech mode).')
    .option('--speed <number>', 'Playback speed multiplier (speech mode).')
    .option('--instructions <text>', 'Steering text for steerable voices (speech mode).')
    // Speech / Transcription share --format
    .option('--format <format>', 'Output format (speech / transcription mode).')
    // Transcription
    .option('--language <code>', 'ISO-639-1 language hint (transcription mode).')
    .option('--prompt <text>', 'Bias prompt to guide transcription (transcription mode).')
    // Video
    .option('--aspect <ratio>', 'Aspect ratio in W:H form (video mode).')
    .option('--resolution <res>', 'Resolution label or WxH (video mode).')
    .option('--duration <seconds>', 'Clip length in seconds (video mode).')
    .option('--fps <n>', 'Frames per second (video mode).')
    .option('--audio', 'Include synced audio (video mode). Pass --no-audio to force off.')
    .option('--no-audio', 'Force audio off (video mode).')
    // Web/data shared
    .option('--limit <n>', 'Max results (search / map / findall / lookup mode).')
    .option('--depth <tier>', 'Depth tier: basic, standard, deep (search / research mode).')
    // Search
    .option('--freshness <range>', 'Relative freshness window: day, week, month, year (search mode).')
    .option('--after-date <YYYY-MM-DD>', 'Lower bound absolute date (search mode).')
    .option('--before-date <YYYY-MM-DD>', 'Upper bound absolute date (search mode).')
    .option('--include-domains <csv>', 'Comma-separated domains to include (search mode).')
    .option('--exclude-domains <csv>', 'Comma-separated domains to exclude (search mode).')
    .option('--include-content', 'Inline full page content where supported (search mode).')
    // Scrape
    .option('--query <text>', 'Tavily-style chunk reranking intent (scrape mode).')
    // Answer
    .option('--max-citations <n>', 'Cap citations included (answer mode).')
    .option('--include-search', 'Also return underlying search results (answer mode).')
    // Map
    .option('--search <text>', 'Relevance ordering query (map mode).')
    // Crawl
    .option('--max-pages <n>', 'Cap pages crawled (crawl mode).')
    .option('--max-depth <n>', 'Discovery depth (crawl mode).')
    .option('--include-paths <csv>', 'Regex patterns of paths to include (crawl mode).')
    .option('--exclude-paths <csv>', 'Regex patterns of paths to exclude (crawl mode).')
    .option('--allow-external', 'Follow off-domain links (crawl mode).')
    // Research
    .option('--poll-interval <s>', 'Override poll cadence in seconds, or csv backoff steps (research mode).')
    .option('--max-wait <s>', 'Maximum total wait time in seconds (research mode).')
    // Findall
    .option('--entity-type <name>', 'Entity type for the search (findall mode, Parallel).')
    .option('--match-conditions <json>', 'JSON array of {name, description} conditions (findall mode, Parallel).')
    // Enrich / Lookup
    .option('--type <kind>', 'Entity type: person, org (enrich mode); person, org, email (lookup mode).')
    // Enrich
    .option('--min-likelihood <n>', 'Reject results below this likelihood (enrich mode).')
    .option('--require <fields>', 'Comma-separated fields the result must populate (enrich mode).')
    .option('--fields <list>', 'Comma-separated fields to return (enrich mode).');
}

function buildPresetCommand(): Command {
  const presetCommand = new Command('preset')
    .description('Manage named CLI presets (saved bundles of provider/model/flags).');

  addPresetWriteOptions(
    presetCommand
      .command('create')
      .description('Create a new preset.')
      .argument('<name>', 'Preset name (slug: lowercase, digits, - or _).')
      .requiredOption('--mode <mode>', 'Preset mode: text, image, speech, transcription.'),
  ).action(async (name: string, options: PresetWriteOptions) => {
    await handlePresetCreate(name, options);
  });

  addPresetWriteOptions(
    presetCommand
      .command('update')
      .description('Update fields on an existing preset (mode is fixed).')
      .argument('<name>', 'Preset name.')
      .option('--mode <mode>', 'Must match existing mode (otherwise rejected).'),
  ).action(async (name: string, options: PresetWriteOptions) => {
    await handlePresetUpdate(name, options);
  });

  presetCommand
    .command('delete')
    .description('Delete a preset.')
    .argument('<name>', 'Preset name.')
    .action(async (name: string) => {
      await handlePresetDelete(name);
    });

  presetCommand
    .command('rename')
    .description('Rename a preset. Stable preset_id is preserved, so any sessions and usage records keep working.')
    .argument('<old>', 'Existing preset name.')
    .argument('<new>', 'New preset name.')
    .action(async (oldName: string, newName: string) => {
      await handlePresetRename(oldName, newName);
    });

  presetCommand
    .command('list')
    .description('List all presets (name, mode, provider, model).')
    .action(async () => {
      await handlePresetList();
    });

  presetCommand
    .command('show')
    .description('Show full settings for one preset.')
    .argument('<name>', 'Preset name.')
    .action(async (name: string) => {
      await handlePresetShow(name);
    });

  return presetCommand;
}

function buildSessionCommand(): Command {
  const sessionCommand = new Command('session')
    .description('Manage sessions: named scopes for related calls. Adds logging and (in chat mode) accumulated history.');

  sessionCommand
    .command('create')
    .description('Create a new session.')
    .argument('<name>', 'Session name (slug: lowercase, digits, - or _).')
    .option('--mode <mode>', 'Session mode: stateless (default) or chat.')
    .option('--preset <name>', 'Default preset to apply to calls in this session.')
    .option('--label <text>', 'Human-readable label.')
    .option('--record-prompts', 'Log full prompt + system bodies. Off by default for privacy.')
    .addOption(
      // Persisted into session meta but not yet enforced: no token-watcher
      // triggers compaction. Hide from --help until the runtime implements
      // it (planned for v0.2). Existing scripts that pass it still work.
      new Option('--auto-compact', 'Automatically compact chat history near the model context limit.').hideHelp(),
    )
    .action(async (name: string, options: SessionCreateOptions) => {
      await handleSessionCreate(name, options);
    });

  sessionCommand
    .command('use')
    .description('Set the global current-session pointer. Subsequent calls auto-tag.')
    .argument('<name>', 'Session name.')
    .action(async (name: string) => {
      await handleSessionUse(name);
    });

  sessionCommand
    .command('end')
    .description('Clear the current-session pointer.')
    .action(async () => {
      await handleSessionEnd();
    });

  sessionCommand
    .command('current')
    .description('Print the active session (or null if none).')
    .action(async () => {
      await handleSessionCurrent();
    });

  sessionCommand
    .command('list')
    .description('List all sessions.')
    .action(async () => {
      await handleSessionList();
    });

  sessionCommand
    .command('show')
    .description('Show metadata + token totals for one session.')
    .argument('<name>', 'Session name.')
    .action(async (name: string) => {
      await handleSessionShow(name);
    });

  sessionCommand
    .command('delete')
    .description('Delete a session and its log (use --keep-log to preserve log.jsonl).')
    .argument('<name>', 'Session name.')
    .option('--keep-log', 'Preserve log.jsonl, only remove meta + messages.')
    .action(async (name: string, options: SessionDeleteOptions) => {
      await handleSessionDelete(name, options);
    });

  sessionCommand
    .command('log')
    .description('Print log records for a session.')
    .argument('<name>', 'Session name.')
    .option('--since <ts>', 'ISO timestamp lower bound.')
    .option('--limit <n>', 'Cap to the most recent N records.')
    .option('--table', 'Render as a table instead of JSON.')
    .action(async (name: string, options: SessionLogOptions) => {
      await handleSessionLog(name, options);
    });

  sessionCommand
    .command('tail')
    .description('Follow log output (like tail -f). Press Ctrl-C to exit.')
    .argument('<name>', 'Session name.')
    .action(async (name: string) => {
      await handleSessionTail(name);
    });

  sessionCommand
    .command('stats')
    .description('Print token totals and cache hit rate for a session.')
    .argument('<name>', 'Session name.')
    .action(async (name: string) => {
      await handleSessionStats(name);
    });

  sessionCommand
    .command('context')
    .description('Print accumulated chat history for a chat-mode session.')
    .argument('<name>', 'Session name.')
    .option('--json', 'Render as structured JSON instead of human-readable text.')
    .action(async (name: string, options: { json?: boolean }) => {
      await handleSessionContext(name, options);
    });

  sessionCommand
    .command('reset')
    .description('Clear chat messages for a session (keeps log + meta).')
    .argument('<name>', 'Session name.')
    .action(async (name: string) => {
      await handleSessionReset(name);
    });

  sessionCommand
    .command('fork')
    .description('Branch a new session from an existing one (copies meta, log, messages).')
    .argument('<src>', 'Source session name.')
    .argument('<dest>', 'New session name.')
    .action(async (src: string, dest: string) => {
      await handleSessionFork(src, dest);
    });

  sessionCommand
    .command('export')
    .description('Export a session as jsonl or markdown.')
    .argument('<name>', 'Session name.')
    .option('--format <format>', 'Output format: jsonl (default) or md.')
    .action(async (name: string, options: SessionExportOptions) => {
      await handleSessionExport(name, options);
    });

  sessionCommand
    .command('mark')
    .description('Watermark the current point in chat history. Compaction will not summarize past it.')
    .argument('<name>', 'Session name.')
    .argument('<label>', 'Label for the mark (free text).')
    .action(async (name: string, label: string) => {
      await handleSessionMark(name, label);
    });

  sessionCommand
    .command('compact')
    .description('Summarize older messages and rewrite history. Rotates the previous file for recovery.')
    .argument('<name>', 'Session name.')
    .option('--keep-last <n>', 'Number of most-recent messages to preserve verbatim (default 4).')
    .option('--target-tokens <n>', 'Advisory target token budget for the summary.')
    .action(async (name: string, options: SessionCompactOptions) => {
      await handleSessionCompact(name, options);
    });

  return sessionCommand;
}

import { MARMOT_VERSION } from './lib/version.js';

export function createProgram(): Command {
  const program = addRunOptions(new Command())
    .name('marmot')
    .description('Marmot — unified CLI for AI generation, web research, and data lookup.')
    .version(MARMOT_VERSION, '-V, --version', 'Print the marmot version and exit.')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .configureHelp({
      // Color section/group headings ("Usage:", "Options:", "AI generation",
      // etc.) in marmot's brand orange so the help output is scannable.
      styleTitle: (title: string) => ansis.hex('#E55A00').bold(title),
    })
    // Scope parent options to before the subcommand. Without this, `-o`
    // from the parent's text-run option set shadows the same flag on `ai
    // image`, `ai speak`, etc. and the subcommand sees an empty options bag.
    .enablePositionalOptions()
    .argument('[prompt...]', 'Prompt text to send to the selected model.')
    .action(async (promptParts: string[], options: RunCommandOptions & { preset?: string; session?: string }) => {
      const merged = await withPreset(options, 'text');
      await (merged.stream
        ? handleStreamRunCommand(promptParts, merged)
        : handleRunCommand(promptParts, merged));
    });

  const runCommand = addRunOptions(new Command('run'))
    .description('Run a prompt against a provider and model.')
    .argument('[prompt...]', 'Prompt text to send to the selected model.')
    .action(async (promptParts: string[], options: RunCommandOptions & { preset?: string; session?: string }) => {
      const merged = await withPreset(options, 'text');
      await (merged.stream
        ? handleStreamRunCommand(promptParts, merged)
        : handleRunCommand(promptParts, merged));
    });

  const cacheCommand = new Command('cache')
    .description('Manage provider model caches.');

  cacheCommand
    .command('refresh')
    .description('Refresh one provider cache or all provider caches.')
    .argument('[provider]', 'Provider slug or "all".')
    .action(async (provider?: string) => {
      await handleCacheRefreshCommand(provider);
    });

  cacheCommand
    .command('clear')
    .description('Clear cached responses for one provider, all providers, or by query/age.')
    .option('--provider <slug>', 'Clear only this provider.')
    .option('--all', 'Clear every provider.')
    .option('--query <text>', 'Match a substring against entry query labels (requires --provider).')
    .option('--older-than <days>', 'Remove entries older than N days.')
    .action(async (options) => {
      await handleCacheClearCommand(options);
    });

  cacheCommand
    .command('stats')
    .description('Show response-cache size and entry count per provider.')
    .option('--provider <slug>', 'Show stats only for this provider.')
    .action(async (options) => {
      await handleCacheStatsCommand(options);
    });

  const providersCommand = new Command('providers')
    .description('Inspect supported providers.');

  providersCommand
    .command('list')
    .description('List every supported provider — AI, web, and data — with category and env var names.')
    .option('--check-keys', 'Also report enabled state, per-env-var set/unset, and overall ready status per provider.')
    .action(async (options: { checkKeys?: boolean }) => {
      await handleProvidersListCommand({ checkKeys: Boolean(options.checkKeys) });
    });

  const modelsCommand = new Command('models')
    .description('List cached models per provider and mode (text/image/speech/transcription).')
    .option('--provider <slug>', 'Filter to one provider.')
    .option('--mode <mode>', 'Filter to one mode: text, image, speech, transcription.')
    .option('--search <query>', 'Case-insensitive substring filter on model id and name.')
    .option('--limit <n>', 'Cap total matches when --search is set (default 10; 0 for no limit).')
    .option('--json', 'Output as JSON.')
    .action(async (options: ModelsCommandOptions) => {
      await handleModelsCommand(options);
    });

  const aboutCommand = new Command('about')
    .description('Show the marmot CLI banner and version.')
    .action(() => {
      handleAboutCommand();
    });

  const imageCommand = new Command('image')
    .description('Generate an image with a provider that supports image gen.')
    .argument('[prompt...]', 'Prompt text describing the image.')
    .option('--provider <provider>', 'Provider slug: openai, openrouter, vercel, cloudflare.')
    .option('--model <model>', 'Image model slug.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('-o, --output <path>', 'Output path. Use {i} for batches (e.g. ./out-{i}.png).')
    .option('-p, --prompt-file <promptFile>', 'Read prompt text from a file.')
    .option('--n <count>', 'Number of images to generate (1–10, default 1).')
    .option('--size <WxH>', 'Image size, e.g. 1024x1024.')
    .option('--quality <level>', 'Image quality (provider-specific).')
    .option('--style <style>', 'Image style (provider-specific).')
    .option('--seed <number>', 'Seed for reproducibility (provider-specific).')
    .option('--negative <prompt>', 'Negative prompt (provider-specific).')
    .option('--binary', 'Write raw image bytes to stdout (--n 1 only). Default when piped to a non-TTY with --n 1.')
    .option('--b64', 'Emit JSON envelope with base64 image data inline.')
    .option('--json', 'Emit JSON envelope on stdout. Default prints just the file path(s).')
    .option('--no-preview', 'Disable inline image preview on supported terminals (Kitty, Ghostty, WezTerm, iTerm2, Warp).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt generation timeout in seconds (default: 120).')
    .option('--preset <name>', 'Apply a saved preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session for logging.')
    .option('--provider-option <key=value>', 'Generic passthrough (repeatable). Lands in providerOptions[<provider>] for niche image params (gpt-image-1 background, output_format, moderation, etc.).', collectProviderOption, [] as string[])
    .action(async (promptParts: string[], options: ImageRunCommandOptions & { preset?: string; session?: string }) => {
      const merged = await withPreset(options, 'image');
      await handleImageRunCommand(promptParts, merged);
    });

  const configCommand = new Command('config')
    .description('Manage the global config file (~/.marmot/config.json).');

  configCommand
    .command('show')
    .description('Print the current config (human-readable; --json for the envelope).')
    .option('--json', 'Output the raw JSON envelope.')
    .action(async (options: { json?: boolean }) => {
      await handleConfigShow(options);
    });

  configCommand
    .command('path')
    .description('Print the config file path.')
    .action(() => {
      handleConfigPath();
    });

  configCommand
    .command('init')
    .description('Create an empty config file if one does not exist yet.')
    .option('--force', 'Overwrite an existing or malformed config file.')
    .action(async (options: { force?: boolean }) => {
      await handleConfigInit(options);
    });

  configCommand
    .command('set')
    .description('Set a config key (text.provider, text.model, image.provider, image.model).')
    .argument('<key>', 'Dotted-path key, e.g. image.provider')
    .argument('<value>', 'Value to assign')
    .action(async (key: string, value: string) => {
      await handleConfigSet(key, value);
    });

  configCommand
    .command('unset')
    .description('Remove a config key.')
    .argument('<key>', 'Dotted-path key to remove')
    .action(async (key: string) => {
      await handleConfigUnset(key);
    });

  const setupCommand = new Command('setup')
    .description('Interactive hub to view and change default providers + models for each mode.')
    .action(async () => {
      await handleSetupCommand();
    });

  const speakCommand = new Command('speak')
    .description('Generate speech audio from text (TTS).')
    .argument('[text...]', 'Text to speak.')
    .option('--provider <provider>', 'Provider slug: openai, openrouter, vercel, cloudflare.')
    .option('--model <model>', 'Speech model slug.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('-o, --output <path>', 'Output audio path. Defaults to ./speak-<provider>-<timestamp>.<ext>.')
    .option('-p, --prompt-file <promptFile>', 'Read text from a file.')
    .option('--voice <voice>', 'Voice id (provider-specific, e.g. alloy/nova for OpenAI).')
    .option('--format <format>', 'Audio output format (mp3, wav, flac, aac, opus).')
    .option('--speed <number>', 'Playback speed multiplier (0.25 – 4.0).')
    .option('--instructions <text>', 'Steering instructions for steerable voice models.')
    .option('--binary', 'Write raw audio bytes to stdout (no file). Default when piped to a non-TTY.')
    .option('--b64', 'Emit JSON envelope with base64 audio inline.')
    .option('--json', 'Emit JSON envelope on stdout. Default prints just the file path.')
    .option('--play', 'Play the audio through system speakers. On a TTY this is the default; explicit --play also emits bytes to stdout when piped (so it plays AND continues the pipeline).')
    .option('--wait', 'When combined with --play, block until playback finishes (useful in scripts).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt generation timeout in seconds (default: 120).')
    .option('--preset <name>', 'Apply a saved preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session for logging.')
    .option('--provider-option <key=value>', 'Generic passthrough (repeatable). Lands in providerOptions[<provider>] for niche TTS params.', collectProviderOption, [] as string[])
    .action(async (textParts: string[], options: SpeechRunCommandOptions & { preset?: string; session?: string }) => {
      const merged = await withPreset(options, 'speech');
      await handleSpeechRunCommand(textParts, merged);
    });

  const transcribeCommand = new Command('transcribe')
    .description('Transcribe audio file to text (STT).')
    .argument('[audioPath]', 'Path to an audio file. Falls back to stdin (piped audio bytes) when omitted.')
    .option('--provider <provider>', 'Provider slug: openai, openrouter, vercel, cloudflare.')
    .option('--model <model>', 'Transcription model slug.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('-i, --input <path>', 'Audio file path (alternative to positional arg).')
    .option('-o, --output <path>', 'Write rendered output to a file.')
    .option('--language <code>', 'ISO-639-1 language hint (e.g. en, es).')
    .option('--prompt <text>', 'Bias prompt to guide the transcription.')
    .option('--format <format>', 'Output format: text (default), json, srt, vtt, verbose-json.')
    .option('--text', 'Plain text output (now the default — kept for back-compat).')
    .option('--json', 'Alias for --format json (emit the structured envelope).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt generation timeout in seconds (default: 120).')
    .option('--preset <name>', 'Apply a saved preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session for logging.')
    .option('--provider-option <key=value>', 'Generic passthrough (repeatable). Lands in providerOptions[<provider>] for niche STT params (timestamp_granularities, etc.).', collectProviderOption, [] as string[])
    .action(async (audioPath: string | undefined, options: TranscribeRunCommandOptions & { preset?: string; session?: string }) => {
      const merged = await withPreset(options, 'transcription');
      await handleTranscribeRunCommand(audioPath, merged);
    });

  const videoCommand = new Command('video')
    .description('Generate a video clip from a text prompt (text-to-video / image-to-video).')
    .argument('[prompt...]', 'Video prompt. Falls back to stdin when omitted; merges with stdin when both are provided.')
    .option('--provider <provider>', 'Provider slug: openrouter, vercel.')
    .option('--model <model>', 'Video model slug (e.g. google/veo-3.1-lite).')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('-o, --output <path>', 'Output file path. With --n > 1 use the {i} placeholder. Default: auto-named in cwd.')
    .option('-p, --prompt-file <promptFile>', 'Read prompt text from a file.')
    .option('--aspect <ratio>', 'Aspect ratio in W:H form, e.g. 16:9 (default), 9:16, 1:1.')
    .option('--resolution <res>', 'Resolution label (720p, 1080p, 4k) or WxH. Default depends on model.')
    .option('--duration <seconds>', 'Clip length in seconds.')
    .option('--fps <n>', 'Frames per second (only some providers honor this).')
    .option('--audio', 'Generate synced audio. Default off (cheaper); some models always emit audio regardless.')
    .option('--no-audio', 'Force audio off (default).')
    .option('--image <path>', 'Reference image. Repeatable: 1st = first-frame conditioning, 2nd = last-frame.', collectImage, [] as string[])
    .option('--n <count>', 'Number of clips to generate (most models cap at 1).')
    .option('--seed <int>', 'Reproducibility seed.')
    .option('--binary', 'Write raw video bytes to stdout (no file). Default when piped to a non-TTY with --n 1.')
    .option('--b64', 'Emit JSON envelope with base64 video inline.')
    .option('--json', 'Print JSON envelope (paths only).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt generation timeout in seconds (default: 600).')
    .option('--provider-option <key=value>', 'Generic passthrough (repeatable). Lands in providerOptions[<provider>] for niche video params.', collectProviderOption, [] as string[])
    .option('--preset <name>', 'Apply a saved preset as defaults (explicit flags still win). Shorthand: @name.')
    .action(async (promptParts: string[], options: VideoRunCommandOptions & { preset?: string }) => {
      const merged = await withPreset(options, 'video');
      await handleVideoRunCommand(promptParts, merged);
    });

  const completionsCommand = new Command('completions')
    .description('Print a shell completion script (bash, zsh, fish).')
    .argument('[shell]', 'Shell name: bash, zsh, or fish.')
    .action(async (shell?: string) => {
      await handleCompletionsCommand(shell, program);
    });

  // AI generation
  program.addCommand(runCommand.helpGroup('AI generation'));
  program.addCommand(imageCommand.helpGroup('AI generation'));
  program.addCommand(speakCommand.helpGroup('AI generation'));
  program.addCommand(transcribeCommand.helpGroup('AI generation'));
  program.addCommand(videoCommand.helpGroup('AI generation'));

  // Search and enrichment
  program.addCommand(buildSearchCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildScrapeCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildAnswerCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildMapCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildCrawlCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildResearchCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildFindallCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildEnrichCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildLookupCommand().helpGroup('Search and enrichment'));
  program.addCommand(buildVerifyCommand().helpGroup('Search and enrichment'));

  // Other
  program.addCommand(buildGetCommand().helpGroup('Other'));
  program.addCommand(buildTasksCommand().helpGroup('Other'));
  program.addCommand(cacheCommand.helpGroup('Other'));
  program.addCommand(buildPresetCommand().helpGroup('Other'));
  program.addCommand(buildSessionCommand().helpGroup('Other'));
  program.addCommand(setupCommand.helpGroup('Other'));
  program.addCommand(configCommand.helpGroup('Other'));
  program.addCommand(providersCommand.helpGroup('Other'));
  program.addCommand(modelsCommand.helpGroup('Other'));
  program.addCommand(buildUsageCommand().helpGroup('Other'));
  program.addCommand(buildDoctorCommand().helpGroup('Other'));
  program.addCommand(completionsCommand.helpGroup('Other'));
  program.addCommand(aboutCommand.helpGroup('Other'));

  // Raw API passthrough — single command, no heading needed.
  program.addCommand(buildApiCommand().helpGroup(' '));

  return program;
}

// Standard Unix CLI behavior: when the downstream pipe closes early
// (consumer exits, head -n N, etc.), absorb EPIPE silently and exit cleanly
// rather than dumping a stack trace.
function installPipeHandlers(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') {
        process.exit(0);
      }
    });
  }
}

/** Mode → verb dispatch table for sigil expansion. The 12 web/data modes
 *  share their name with their verb. The three AI exceptions remap, and
 *  `text` returns null because it dispatches to the default (no verb token). */
const MODE_TO_VERB: Record<PresetMode, string | null> = {
  text: null,
  image: 'image',
  video: 'video',
  speech: 'speak',
  transcription: 'transcribe',
  search: 'search',
  scrape: 'scrape',
  answer: 'answer',
  map: 'map',
  crawl: 'crawl',
  research: 'research',
  findall: 'findall',
  enrich: 'enrich',
  lookup: 'lookup',
  verify: 'verify',
};

/** Best-effort sync read of a preset's mode for sigil expansion. Bypasses
 *  zod validation — we only need `mode`, and any malformed-config errors
 *  will surface clearly later when commander dispatches to the verb. */
function readPresetModeSync(name: string): PresetMode | null {
  try {
    const path = getMarmotConfigPath();
    const raw = readFileSync(path, 'utf8');
    const config = JSON.parse(raw) as { presets?: Record<string, { mode?: string }> };
    const mode = config.presets?.[name]?.mode;
    if (!mode || !(mode in MODE_TO_VERB)) return null;
    return mode as PresetMode;
  } catch {
    return null;
  }
}

/**
 * Strip `--no-log` and `--redact` from argv and set the matching env vars
 * so the existing `isUsageLoggingEnabled` / `shouldRecordSensitive`
 * helpers honor them. These work on every verb without per-command wiring
 * because commander never sees them — they're consumed at argv level
 * before parsing.
 *
 * - `--no-log` → `MARMOT_NO_LOG=1` (no record at all this call).
 * - `--redact` → `MARMOT_REDACT=1` (record metadata, omit sensitive
 *   payload even if `logging.recordSensitive` is on globally).
 *
 * Returns the filtered argv. Mutates `process.env` so the rest of the
 * call honors the override.
 */
export function applyGlobalLoggingFlags(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = [];
  for (const tok of argv) {
    if (tok === '--no-log') {
      env.MARMOT_NO_LOG = '1';
      continue;
    }
    if (tok === '--redact') {
      env.MARMOT_REDACT = '1';
      continue;
    }
    out.push(tok);
  }
  return out;
}

/**
 * Rewrites a single `@preset-name` token (anywhere after argv[1]) into an
 * explicit `--preset <name>` pair. When the user hasn't specified a verb,
 * peek at the saved preset's mode and inject the matching verb so
 * `marmot @linkedin "query"` dispatches to `search` instead of falling
 * back to text-run and erroring on a mode mismatch.
 *
 * Only the first matching token is consumed; additional `@…` tokens are
 * left in place so `marmot run "@user said hi"` keeps the literal in the
 * prompt. Refuses if --preset is already present.
 */
export function expandPresetSigil(
  argv: readonly string[],
  lookupMode: (name: string) => PresetMode | null = readPresetModeSync,
): string[] {
  const out = [...argv];
  const hasExplicit = out.some((a) => a === '--preset' || a.startsWith('--preset='));
  if (hasExplicit) return out;

  for (let i = 2; i < out.length; i++) {
    const tok = out[i]!;
    if (!tok.startsWith('@') || tok.length < 2) continue;
    const candidate = tok.slice(1);
    if (!PRESET_NAME_REGEX.test(candidate)) continue;

    // Inject a verb if argv[2] is the sigil itself — meaning the user typed
    // `marmot @name ...` with no explicit verb. If argv[2] is a flag (starts
    // with `-`) or another token, treat that as the user's choice and don't
    // override.
    if (i === 2) {
      const mode = lookupMode(candidate);
      const verb = mode ? MODE_TO_VERB[mode] : null;
      if (verb) {
        out.splice(i, 1, verb, '--preset', candidate);
        return out;
      }
    }
    out.splice(i, 1, '--preset', candidate);
    return out;
  }
  return out;
}

async function main(): Promise<void> {
  installPipeHandlers();
  installSignalHandlers();
  const program = createProgram();

  if (process.argv.length === 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(expandPresetSigil(applyGlobalLoggingFlags(process.argv)));
}

// Restore the cursor (which spinners hide) on SIGINT so users don't need to
// `reset` their terminal after a Ctrl+C. Exit code 130 is the POSIX
// convention for "terminated by SIGINT" (128 + signal number).
function installSignalHandlers(): void {
  process.on('SIGINT', () => {
    if (process.stderr.isTTY) {
      process.stderr.write('[?25h');
    }
    process.exit(130);
  });
}

// Only auto-run when invoked as the CLI entry, not when imported by tests.
// The previous filename-suffix heuristic broke for npm-installed binaries:
// `.bin/marmot` is a symlink to dist/cli.js, and Node sets argv[1] to the
// symlink path ("/.../node_modules/.bin/marmot"), which doesn't end in
// cli.js. Compare import.meta.url to pathToFileURL(realpathSync(argv[1]))
// instead — that resolves the symlink before matching, so any invocation
// (direct, symlinked bin, or future shim layout) works.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function isMainEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    const resolved = realpathSync(process.argv[1]);
    return pathToFileURL(resolved).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  void main().catch((error) => {
    // Honor `--json` (anywhere in argv) by emitting a structured error
    // envelope instead of human-formatted text. Lets agent harnesses parse
    // failures without pattern-matching stderr.
    const wantsJson = process.argv.includes('--json');
    if (wantsJson) {
      process.stderr.write(`${formatCliErrorJson(error)}\n`);
    } else {
      process.stderr.write(`${formatCliError(error)}\n`);
    }
    process.exitCode = getExitCode(error);
  });
}
