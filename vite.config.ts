/**
 * Vite config — includes a dev-only level-save endpoint for the in-game editor.
 *
 * POST /api/levels/:name  (JSON body = LevelData)
 *   → writes to public/levels/:name.json so the next page load serves it.
 *
 * The endpoint ONLY exists on `vite dev`.  Production builds do not expose it,
 * so the editor is effectively a development tool.
 */
import { defineConfig, type Plugin } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const LEVELS_DIR = resolve(__dirname, 'public/levels');
const ROUTE_PREFIX = '/api/levels/';

function saveLevelPlugin(): Plugin {
  return {
    name: 'robot-lords-save-level',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || !req.url?.startsWith(ROUTE_PREFIX)) {
          next();
          return;
        }
        // Extract + validate level name (letters/digits/underscore/hyphen only).
        const name = req.url.slice(ROUTE_PREFIX.length).split('?')[0];
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          res.statusCode = 400;
          res.end('invalid level name');
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body); // validates JSON + echoes back
            const filePath = join(LEVELS_DIR, `${name}.json`);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `/levels/${name}.json` }));
          } catch (err) {
            res.statusCode = 500;
            res.end(`save failed: ${(err as Error).message}`);
          }
        });
        req.on('error', () => {
          res.statusCode = 500;
          res.end('request stream error');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveLevelPlugin()],
});
