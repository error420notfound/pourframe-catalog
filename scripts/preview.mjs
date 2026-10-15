import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { buildPages } from './build-pages.mjs'

const site = resolve(await buildPages())
const prefix = '/pourframe-catalog/'
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.yml': 'text/yaml; charset=utf-8' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (pathname === '/' || pathname === '/pourframe-catalog') {
      response.writeHead(302, { location: prefix }); response.end(); return
    }
    if (!pathname.startsWith(prefix)) throw new Error('Not found')
    let path = resolve(site, pathname.slice(prefix.length))
    if (path !== site && !path.startsWith(`${site}${sep}`)) throw new Error('Not found')
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html')
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    response.end(await readFile(path))
  } catch { response.writeHead(404); response.end('Not found') }
})
server.on('error', error => { console.error(`Preview server: ${error.message}. Set PORT to an available local port.`); process.exitCode = 1 })
server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`Preview: http://localhost:${server.address().port}${prefix}admin/`))
