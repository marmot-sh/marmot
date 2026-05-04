// Cross-provider capability matrix for the data verbs (enrich, lookup, verify).
// Source of truth for `marmot <verb> --type X --provider Y` validation and
// for `marmot providers list --verb`.
//
// last verified per provider:
//   apollo      2026-05-02 — _docs/providers/apollo.md
//   hunter      2026-05-02 — _docs/providers/hunter.md
//   pdl         2026-05-02 — _docs/providers/pdl.md
//   tomba       2026-05-03 — _docs/providers/tomba.md
//   bouncer     2026-05-03 — _docs/providers/bouncer.md
//   datagma     2026-05-03 — _docs/providers/datagma.md
//   zerobounce  2026-05-03 — _docs/providers/zerobounce.md
//   kickbox     2026-05-03 — _docs/providers/kickbox.md

import {
  DATA_PROVIDERS,
  DATA_TYPES,
  DATA_VERBS,
  type DataProviderSlug,
  type DataType,
  type DataVerb,
} from '@marmot-sh/core';

export type DataCapabilityKey = `${DataVerb}.${DataType}`;

export const DATA_CAPABILITY_MATRIX: Record<DataCapabilityKey, readonly DataProviderSlug[]> = {
  'enrich.person': ['apollo', 'hunter', 'pdl', 'tomba', 'datagma'],
  'enrich.org': ['apollo', 'hunter', 'pdl', 'tomba'],
  'enrich.email': [],
  'lookup.person': ['apollo', 'pdl'],
  'lookup.org': ['apollo', 'pdl', 'tomba'],
  'lookup.email': ['hunter', 'tomba'],
  'verify.person': [],
  'verify.org': [],
  'verify.email': ['hunter', 'tomba', 'bouncer', 'datagma', 'zerobounce', 'kickbox'],
};

export function providersForCell(verb: DataVerb, type: DataType): readonly DataProviderSlug[] {
  return DATA_CAPABILITY_MATRIX[`${verb}.${type}` as DataCapabilityKey];
}

export function cellSupportsProvider(
  verb: DataVerb,
  type: DataType,
  provider: DataProviderSlug,
): boolean {
  return providersForCell(verb, type).includes(provider);
}

export function typesForVerb(verb: DataVerb): DataType[] {
  return DATA_TYPES.filter((t) => providersForCell(verb, t).length > 0);
}

export function cellsForProvider(provider: DataProviderSlug): DataCapabilityKey[] {
  return (Object.keys(DATA_CAPABILITY_MATRIX) as DataCapabilityKey[]).filter((key) =>
    DATA_CAPABILITY_MATRIX[key].includes(provider),
  );
}

export function isDataProvider(slug: string): slug is DataProviderSlug {
  return (DATA_PROVIDERS as readonly string[]).includes(slug);
}

export function isDataVerb(name: string): name is DataVerb {
  return (DATA_VERBS as readonly string[]).includes(name);
}

export function isDataType(name: string): name is DataType {
  return (DATA_TYPES as readonly string[]).includes(name);
}
