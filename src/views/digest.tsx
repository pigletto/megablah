import type { DigestRow, Night } from '../digest/types.js';

const MISSING = '—';

// Empty or missing text is shown as the dash, never as an empty cell.
function cell(value: string | null | undefined): string {
  return value === undefined || value === null || value === '' ? MISSING : value;
}

function isWarn(row: DigestRow): boolean {
  return row.retries >= 3 || row.lastStatus === 'fail';
}

// Plain code-unit order, so the page order does not depend on the host locale.
function byJob(a: DigestRow, b: DigestRow): number {
  return a.job < b.job ? -1 : a.job > b.job ? 1 : 0;
}

export function Digest({ night }: { night: Night }) {
  const rows = [...night.rows].sort(byJob);
  return (
    <>
      <h1>digest · {night.night}</h1>
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first at</th>
              <th>last at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr class={isWarn(r) ? 'warn' : undefined}>
                <td>{cell(r.job)}</td>
                <td>{cell(r.owner)}</td>
                <td>{r.runs}</td>
                <td>{r.retries}</td>
                <td>{cell(r.lastStatus)}</td>
                <td>{cell(r.lastError)}</td>
                <td>{cell(r.firstAt)}</td>
                <td>{cell(r.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {night.badLines > 0 ? <p class="mute">{night.badLines} unreadable {night.badLines === 1 ? 'line' : 'lines'} skipped</p> : null}
    </>
  );
}
