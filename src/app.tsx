import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/read-night.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    const name = c.req.param('night');
    // The night names a file under runs/: only a plain date is accepted.
    const night = /^\d{4}-\d{2}-\d{2}$/.test(name) ? readNight(config.runsDir, name) : null;
    if (night === null) return c.text('no such night', 404);
    return c.html(
      <Layout title={`digest ${name}`} lane={lane()}>
        <Digest night={night} />
      </Layout>,
    );
  });

  return app;
}
