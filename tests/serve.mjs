import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

const root = resolve('dist/client')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(`${root}/`)) { response.writeHead(403).end(); return }
    const content = await readFile(path)
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(content)
  } catch { response.writeHead(404).end() }
}).listen(4173, '127.0.0.1')
