/* server.mjs - the static server the browser tests load the app from.
 *
 * Deliberately not a dependency: ES modules need HTTP (file:// is blocked)
 * and that is the only reason this exists. It serves the working tree read
 * only, on an ephemeral port, and is closed when the test file ends - so a
 * test run leaves nothing listening and nothing written.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.txt':'text/plain; charset=utf-8', '.json':'application/json',
  '.mp3':'audio/mpeg', '.png':'image/png', '.svg':'image/svg+xml'
};

/** @returns {Promise<{origin:string, close:()=>Promise<void>}>} */
export async function startServer(){
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    // never serve anything outside the working tree
    if(!file.startsWith(ROOT)){ res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if(err){ res.writeHead(404, {'Content-Type':'text/plain'}).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      }).end(body);
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(done => server.close(done))
  };
}
