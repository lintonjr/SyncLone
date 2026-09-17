const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { ambiente } = require('./ajuda');

/**
 * Um "site" local que imita o comportamento do CloudFront + backend + S3.
 * `defeitos` liga comportamentos errados, um por vez.
 */
function umSite(defeitos = {}) {
  const seguranca = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff' };
  return http.createServer((req, res) => {
    const url = req.url;
    if (url === '/api/health') {
      if (req.headers['x-origin-verify'] && defeitos.headerForjadoBarrado) return res.writeHead(403, seguranca).end();
      return res.writeHead(200, { ...seguranca, 'content-type': 'application/json' }).end('{"status":"ok"}');
    }
    if (url.startsWith('/api/events/') && url.endsWith('/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      return res.write(': ping\n\n');
    }
    if (url.startsWith('/api/')) {
      // O defeito h: errorResponses transformavam 404 da API em 200 + HTML.
      if (defeitos.erroApiViraHtml) return res.writeHead(200, { ...seguranca, 'content-type': 'text/html' }).end('<html>');
      return res.writeHead(404, { ...seguranca, 'content-type': 'application/json' }).end('{"error":"Event not found"}');
    }
    if (url.startsWith('/uploads/')) return res.writeHead(403, { ...seguranca, 'content-type': 'application/xml' }).end('<Error/>');
    const semHsts = defeitos.semHsts ? { 'x-content-type-options': 'nosniff' } : seguranca;
    return res.writeHead(200, { ...semHsts, 'content-type': 'text/html' }).end('<html>');
  });
}

async function comSite(t, defeitos) {
  const site = umSite(defeitos);
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { site.closeAllConnections(); site.close(r); }));
  return `http://127.0.0.1:${site.address().port}`;
}

const rodarFumaca = (t, url) => {
  const amb = ambiente(t, { env: { FUMACA_URL: url, FUMACA_PULAR_ORIGEM: '1', MANASYNC_CURL: 'curl' } });
  return amb.rodarAsync('fumaca.sh');
};

test('fumaça: site correto passa limpo', async (t) => {
  const r = await rodarFumaca(t, await comSite(t));
  assert.equal(r.codigo, 0, r.erro);
  assert.match(r.erro, /fumaça limpa/);
  assert.doesNotMatch(r.erro, /FALHOU/);
});

test('fumaça: 404 da API virando HTML (defeito h) é pego', async (t) => {
  const r = await rodarFumaca(t, await comSite(t, { erroApiViraHtml: true }));
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /FALHOU 404 da API chega como 404 JSON/);
});

test('fumaça: header de origem forjado barrado (CloudFront não sobrescreveu) é pego', async (t) => {
  const r = await rodarFumaca(t, await comSite(t, { headerForjadoBarrado: true }));
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /FALHOU header x-origin-verify forjado/);
});

test('fumaça: sem HSTS é pego', async (t) => {
  const r = await rodarFumaca(t, await comSite(t, { semHsts: true }));
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /FALHOU HSTS presente/);
});

test('fumaça: site fora do ar falha tudo, sem travar', async (t) => {
  const r = await rodarFumaca(t, 'http://127.0.0.1:9');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /verificação\(ões\) falharam/);
});
