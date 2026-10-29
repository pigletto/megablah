import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, RunLine } from '../src/digest/types.js';

let runsDir = '';

function app() {
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
}

function line(l: RunLine): string {
  return JSON.stringify(l);
}

const BUSY: RunLine[] = [
  { at: '2026-10-28T23:00:02+01:00', job: 'zeta/first', status: 'ok', owner: 'lane-07' },
  { at: '2026-10-28T23:10:00+01:00', job: 'alpha/second', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-28T23:11:00+01:00', job: 'alpha/second', status: 'ok', owner: 'rook' },
  { at: '2026-10-28T23:30:00+01:00', job: 'mid/third', status: 'fail', owner: null, error: 'quota exceeded' },
];

function jobsIn(rows: DigestRow[]): string[] {
  return rows.map((r) => r.job);
}

// Position of each job name in the page, in the order the page shows them.
function jobsInPageOrder(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, at: html.indexOf(job) }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(runsDir, '2026-11-01.jsonl'), BUSY.map(line).join('\n') + '\n');
  writeFileSync(join(runsDir, '2026-11-02.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-11-03.jsonl'),
    [line(BUSY[0]!), 'this is not json', line(BUSY[3]!), '{"at":"2026-11-03T05:59:58+01:00","job":"lane/sy'].join('\n'),
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest page', () => {
  it('answers 200 for a night that exists and lists its jobs', async () => {
    const res = await app().request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const l of BUSY) expect(html).toContain(l.job);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app().request('/digest/2026-11-30');
    expect(res.status).toBe(404);
  });

  it('renders the empty night as "nothing ran"', async () => {
    const res = await app().request('/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('does not say "nothing ran" for a night where jobs ran', async () => {
    const html = await (await app().request('/digest/2026-11-01')).text();
    expect(html).not.toContain('nothing ran');
  });

  it('still renders a night with bad lines, and lists the good ones', async () => {
    const res = await app().request('/digest/2026-11-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('zeta/first');
    expect(html).toContain('mid/third');
    expect(html).not.toContain('nothing ran');
  });

  it('serves the real read-only night', async () => {
    const real = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' });
    const res = await real.request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('fixtures/refresh');
    expect(html).toContain('notes/backup');
  });
});

describe('digest json', () => {
  it('answers 200 with one row per job for a night that exists', async () => {
    const res = await app().request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const rows = (await res.json()) as DigestRow[];
    expect(jobsIn(rows).sort()).toEqual(['alpha/second', 'mid/third', 'zeta/first']);
    const second = rows.find((r) => r.job === 'alpha/second');
    expect(second).toMatchObject({ runs: 2, retries: 1, lastStatus: 'ok', owner: 'rook' });
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app().request('/api/digest/2026-11-30');
    expect(res.status).toBe(404);
  });

  it('answers an empty list for the empty night', async () => {
    const res = await app().request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('still answers for a night with bad lines, with the good ones', async () => {
    const res = await app().request('/api/digest/2026-11-03');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as DigestRow[];
    expect(jobsIn(rows).sort()).toEqual(['mid/third', 'zeta/first']);
  });
});

describe('page and json agree', () => {
  it.each(['2026-11-01', '2026-11-03'])('list the same jobs in the same order for %s', async (night) => {
    const rows = (await (await app().request(`/api/digest/${night}`)).json()) as DigestRow[];
    const html = await (await app().request(`/digest/${night}`)).text();
    const jobs = jobsIn(rows);
    expect(jobs.length).toBeGreaterThan(1);
    for (const job of jobs) expect(html).toContain(job);
    expect(jobsInPageOrder(html, jobs)).toEqual(jobs);
  });

  it('agree on the real night too', async () => {
    const real = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' });
    const rows = (await (await real.request('/api/digest/2026-10-28')).json()) as DigestRow[];
    const html = await (await real.request('/digest/2026-10-28')).text();
    const jobs = jobsIn(rows);
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobsInPageOrder(html, jobs)).toEqual(jobs);
  });
});
