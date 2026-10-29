import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, RunLine, RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// The edge: one raw line in, a RunLine or null out. Nothing below this trusts the file.
function parseLine(raw: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  if (typeof line.at !== 'string' || line.at === '') return null;
  if (typeof line.job !== 'string' || line.job === '') return null;
  if (!isStatus(line.status)) return null;
  if (!(line.owner === null || line.owner === undefined || typeof line.owner === 'string')) return null;
  if (!(line.error === undefined || typeof line.error === 'string')) return null;
  return {
    at: line.at,
    job: line.job,
    status: line.status,
    owner: line.owner ?? null,
    ...(line.error === undefined ? {} : { error: line.error }),
  };
}

type Seen = { line: RunLine; at: number | null; index: number };

// Later in the night? Timestamps carry an offset, so compare the instant, never the string.
// A timestamp Date can't read falls back to the order it had in the file.
function isAfter(candidate: Seen, current: Seen): boolean {
  if (candidate.at !== null && current.at !== null && candidate.at !== current.at) {
    return candidate.at > current.at;
  }
  return candidate.index > current.index;
}

type Fold = {
  first: Seen;
  last: Seen;
  // The latest line that named an owner, and the latest that carried an error. Null when no
  // line of this job ever did.
  lastOwner: Seen | null;
  lastError: Seen | null;
  runs: number;
  retries: number;
};

/**
 * Read `runs/<night>.jsonl` into one row per job. Returns null when the night has no file.
 * Lines that do not parse are counted in `badLines`, never thrown. `runsDir` is read-only.
 */
export function readNight(runsDir: string, night: string): Night | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let badLines = 0;
  const folds = new Map<string, Fold>();
  let index = 0;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines += 1;
      continue;
    }
    const parsedAt = Date.parse(line.at);
    const seen: Seen = { line, at: Number.isNaN(parsedAt) ? null : parsedAt, index };
    index += 1;

    const fold = folds.get(line.job);
    if (fold === undefined) {
      folds.set(line.job, {
        first: seen,
        last: seen,
        lastOwner: line.owner === null ? null : seen,
        lastError: line.error === undefined ? null : seen,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
      });
      continue;
    }
    fold.runs += 1;
    if (line.status === 'retry') fold.retries += 1;
    if (!isAfter(seen, fold.first)) fold.first = seen;
    if (isAfter(seen, fold.last)) fold.last = seen;
    if (line.owner !== null && (fold.lastOwner === null || isAfter(seen, fold.lastOwner))) {
      fold.lastOwner = seen;
    }
    if (line.error !== undefined && (fold.lastError === null || isAfter(seen, fold.lastError))) {
      fold.lastError = seen;
    }
  }

  const rows: DigestRow[] = [...folds.entries()]
    .map(([job, fold]) => ({
      job,
      owner: fold.lastOwner?.line.owner ?? null,
      runs: fold.runs,
      retries: fold.retries,
      lastStatus: fold.last.line.status,
      lastError: fold.lastError?.line.error ?? null,
      firstAt: fold.first.line.at,
      lastAt: fold.last.line.at,
    }))
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines };
}
