import { AnnouncementStore, validateInput } from './announcements'
import { ApiError, GitCodeClient } from './gitcode'

interface Env {
  ADMIN_USERNAME: string
  ADMIN_PASSWORD: string
  GITCODE_TOKEN: string
  GITCODE_OWNER?: string
  GITCODE_REPO?: string
  GITCODE_BRANCH?: string
  SESSION_KV: KVNamespace
}

const SESSION_SECONDS = 24 * 60 * 60
const COOKIE = 'neo_bpsys_session'

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

function cookieToken(request: Request): string | null {
  const match = request.headers.get('Cookie')?.match(/(?:^|;\s*)neo_bpsys_session=([a-f0-9]{64})(?:;|$)/)
  return match?.[1] ?? null
}

function cookie(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function equalSecret(actual: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(actual), digest(expected)])
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

async function session(request: Request, env: Env): Promise<boolean> {
  const token = cookieToken(request)
  if (!token) return false
  const value = await env.SESSION_KV.get(`session:${token}`, 'json') as { expiresAt?: string } | null
  return Boolean(value && value.expiresAt && Date.parse(value.expiresAt) > Date.now())
}

async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get('Content-Length')) > 1_000_000) throw new ApiError(413, '请求内容过大。')
  try { return await request.json() }
  catch { throw new ApiError(400, '请求 JSON 无效。') }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  if (!path.startsWith('/api/')) return new Response('Not Found', { status: 404 })
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) return json({ error: '方法不支持。' }, 405)
  if (method !== 'GET') {
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) throw new ApiError(403, '请求来源无效。')
  }

  if (path === '/api/auth/login' && method === 'POST') {
    if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_KV) throw new ApiError(503, '管理员登录尚未配置。')
    const value = await body(request)
    const username = object(value) && typeof value.username === 'string' ? value.username : ''
    const password = object(value) && typeof value.password === 'string' ? value.password : ''
    const [userMatches, passwordMatches] = await Promise.all([equalSecret(username, env.ADMIN_USERNAME), equalSecret(password, env.ADMIN_PASSWORD)])
    if (!userMatches || !passwordMatches) throw new ApiError(401, '用户名或密码错误。')
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    const now = new Date()
    await env.SESSION_KV.put(`session:${token}`, JSON.stringify({ username, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString() }), { expirationTtl: SESSION_SECONDS })
    return json({ authenticated: true, username }, 200, { 'Set-Cookie': cookie(token, SESSION_SECONDS) })
  }

  if (path === '/api/auth/session' && method === 'GET') {
    return (await session(request, env)) ? json({ authenticated: true }) : json({ authenticated: false }, 401)
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    const token = cookieToken(request)
    if (token) await env.SESSION_KV.delete(`session:${token}`)
    return json({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) })
  }

  const isAdminRoute = path.startsWith('/api/admin/')
  if (isAdminRoute && !(await session(request, env))) throw new ApiError(401, '登录已失效，请重新登录。')
  if (!env.GITCODE_TOKEN) throw new ApiError(503, 'GitCode Token 尚未配置。')
  const store = new AnnouncementStore(new GitCodeClient(env.GITCODE_TOKEN, env.GITCODE_OWNER || 'PLFJY', env.GITCODE_REPO || 'neo-bpsys-announce-source', env.GITCODE_BRANCH || 'main'))

  if (isAdminRoute) {
    if (path === '/api/admin/announcements') {
      if (method === 'GET') return json(await store.list())
      if (method === 'POST') return json(await store.create(validateInput(await body(request))), 201)
    }
    const match = path.match(/^\/api\/admin\/announcements\/(\d{8}-\d{3})$/)
    if (match) {
      const id = match[1]
      if (method === 'GET') return json(await store.detail(id))
      const value = await body(request)
      if (!object(value)) throw new ApiError(400, '请求内容无效。')
      if (method === 'PUT') {
        if (typeof value.fileSha !== 'string' || !(typeof value.manifestSha === 'string' || value.manifestSha === null)) throw new ApiError(400, '缺少版本信息。')
        return json(await store.update(id, validateInput(value), value.fileSha, value.manifestSha))
      }
      if (method === 'PATCH') {
        if (typeof value.enabled !== 'boolean' || !(typeof value.manifestSha === 'string' || value.manifestSha === null)) throw new ApiError(400, '请求内容无效。')
        return json(await store.setEnabled(id, value.enabled, value.manifestSha))
      }
    }
  }

  if (path === '/api/public/v1/manifest' && method === 'GET') {
    const { data } = await store.manifest()
    return json({ ...data, announcements: data.announcements.filter(item => item.enabled) }, 200, { 'Cache-Control': 'public, max-age=120' })
  }
  const publicMatch = path.match(/^\/api\/public\/v1\/announcements\/(\d{8}-\d{3})$/)
  if (publicMatch && method === 'GET') {
    const detail = await store.detail(publicMatch[1])
    if (!detail.entry.enabled) throw new ApiError(404, '公告不存在。')
    if (detail.actualSha256 !== detail.entry.sha256) throw new ApiError(502, '公告内容与 manifest 不一致。')
    return json(detail.announcement, 200, { 'Cache-Control': 'public, max-age=300' })
  }
  return json({ error: '接口不存在。' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env) }
    catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status)
      console.error('Unexpected Worker error', error instanceof Error ? error.name : 'unknown')
      return json({ error: '服务器暂时无法处理请求。' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
