import { Command } from 'commander';

import { buildBraveCommand } from './passthrough/brave.js';
import { buildExaCommand } from './passthrough/exa.js';
import { buildFirecrawlCommand } from './passthrough/firecrawl.js';
import { buildTavilyCommand } from './passthrough/tavily.js';

/**
 * `marmot api <provider> <subcommand>` — direct passthrough to a provider's
 * native API. Bypasses marmot's normalized verbs (search, scrape, etc.) and
 * returns the provider's response shape verbatim. Use when you need fields
 * marmot doesn't expose, or when you're scripting against a provider you
 * already know well.
 */
export function buildApiCommand(): Command {
  const cmd = new Command('api').description(
    'Direct provider API passthrough (brave, exa, firecrawl, tavily).',
  );

  cmd.addCommand(buildBraveCommand());
  cmd.addCommand(buildExaCommand());
  cmd.addCommand(buildFirecrawlCommand());
  cmd.addCommand(buildTavilyCommand());

  return cmd;
}
