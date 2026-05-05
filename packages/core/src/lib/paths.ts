import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  PROVIDER_CACHE_DIRNAME,
  PROVIDER_IMAGE_CACHE_DIRNAME,
  PROVIDER_SPEECH_CACHE_DIRNAME,
  PROVIDER_TRANSCRIPTION_CACHE_DIRNAME,
  PROVIDER_VIDEO_CACHE_DIRNAME,
  type ProviderSlug,
} from './constants.js';

export function expandHomePath(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }

  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function resolveUserPath(
  inputPath: string,
  cwd: string = process.cwd(),
): string {
  const expanded = expandHomePath(inputPath);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function getMarmotHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicitHome = env.MARMOT_HOME?.trim();
  return explicitHome ? resolveUserPath(explicitHome) : join(homedir(), '.marmot');
}

/**
 * Root directory for response caches (web/data sync verb results). One
 * subdirectory per provider, JSON files named by SHA-256 hash of the request.
 */
export function getResponseCacheDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMarmotHome(env), 'cache', 'responses');
}

export function getProviderResponseCacheDir(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getResponseCacheDir(env), provider);
}

export function getResponseCacheEntryPath(
  provider: string,
  hash: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getProviderResponseCacheDir(provider, env), `${hash}.json`);
}

export function getProviderCachePath(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMarmotHome(env), PROVIDER_CACHE_DIRNAME, `${provider}.json`);
}

export function getProviderImageCachePath(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMarmotHome(env), PROVIDER_IMAGE_CACHE_DIRNAME, `${provider}.json`);
}

export function getProviderSpeechCachePath(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMarmotHome(env), PROVIDER_SPEECH_CACHE_DIRNAME, `${provider}.json`);
}

export function getProviderVideoCachePath(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMarmotHome(env), PROVIDER_VIDEO_CACHE_DIRNAME, `${provider}.json`);
}

export function getProviderTranscriptionCachePath(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(getMarmotHome(env), PROVIDER_TRANSCRIPTION_CACHE_DIRNAME, `${provider}.json`);
}

export function getMarmotConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getMarmotHome(env), 'config.json');
}

export function getSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getMarmotHome(env), 'sessions');
}

export function getSessionDir(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getSessionsDir(env), name);
}

export function getSessionMetaPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getSessionDir(name, env), 'meta.json');
}

export function getSessionLogPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getSessionDir(name, env), 'log.jsonl');
}

export function getSessionMessagesPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getSessionDir(name, env), 'messages.jsonl');
}

export function getCurrentSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getMarmotHome(env), 'current-session');
}

export function getWebTasksPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getMarmotHome(env), 'tasks.json');
}
