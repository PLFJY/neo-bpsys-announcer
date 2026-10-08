import { channels, languages, type Announcement, type AnnouncementDetail, type Channel, type Level, type Manifest, type ManifestEntry, type Translations } from '../src/types'
import { ApiError, GitHubClient, type GitFile } from './github'

const emptyManifest = (): Manifest => ({ schemaVersion: 1, announcements: [] })
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const validDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const validVersion = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value))
const validChannels = (value: unknown): value is Channel[] => Array.isArray(value) && value.length > 0 && value.every(item => channels.includes(item)) && new Set(value).size === value.length
const validTranslations = (value: unknown): value is Translations => record(value) && languages.every(lang => typeof value[lang] === 'string')
const validLevel = (value: unknown): value is Level => value === 'info' || value === 'warning' || value === 'critical'
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  !value.startsWith('/') && !value.includes('..') && !value.includes('\\') &&
  !/^[a-z][a-z0-9+.-]*:/i.test(value) && !/[?#]/.test(value) && value.split('/').every(Boolean)

function parseJson(file: GitFile, kind: string): unknown {
  try { return JSON.parse(file.content) }
  catch { throw new ApiError(502, `${kind} JSON 已损坏。`) }
}

function parseManifest(file: GitFile | null): Manifest {
  if (!file) return emptyManifest()
  const value = parseJson(file, 'manifest')
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.announcements) || !value.announcements.every(item =>
    record(item) && typeof item.id === 'string' && /^\d{8}-\d{3}$/.test(item.id) && (item.path === undefined || validPath(item.path)) && validDate(item.publishedAt) && validDate(item.updatedAt) &&
    typeof item.enabled === 'boolean' && Number.isInteger(item.revision) && Number(item.revision) > 0 &&
    typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256) && validVersion(item.minAppVersion) &&
    validVersion(item.maxAppVersion) && validChannels(item.channels)
  )) throw new ApiError(502, 'manifest JSON 已损坏。')
  return value as unknown as Manifest
}

function parseAnnouncement(file: GitFile, expectedId: string): Announcement {
  const value = parseJson(file, '公告')
  if (!record(value) || value.schemaVersion !== 1 || value.id !== expectedId || !validDate(value.publishedAt) ||
    !validDate(value.updatedAt) || !validLevel(value.level) || !validTranslations(value.title) ||
    !validTranslations(value.content) || !validVersion(value.minAppVersion) || !validVersion(value.maxAppVersion) ||
    !validChannels(value.channels)) throw new ApiError(502, '公告 JSON 已损坏。')
  return value as unknown as Announcement
}

export interface AnnouncementInput {
  publishedAt: string
  level: Level
  title: Translations
  content: Translations
  minAppVersion: string | null
  maxAppVersion: string | null
  channels: Channel[]
}

export function validateInput(value: unknown): AnnouncementInput {
  if (!record(value) || !validDate(value.publishedAt) || !validLevel(value.level) ||
    !validTranslations(value.title) || !validTranslations(value.content) || !validVersion(value.minAppVersion) ||
    !validVersion(value.maxAppVersion) || !validChannels(value.channels)) {
    throw new ApiError(400, '请填写有效的公告信息，中文标题和正文必填，其他语言的标题与正文需同时填写。')
  }
  const title = value.title as Translations
  const content = value.content as Translations
  if (!title['zh-CN'].trim() || !content['zh-CN'].trim() ||
    languages.some(lang => Boolean(title[lang].trim()) !== Boolean(content[lang].trim()))) {
    throw new ApiError(400, '请填写有效的公告信息，中文标题和正文必填，其他语言的标题与正文需同时填写。')
  }
  return {
    publishedAt: value.publishedAt,
    level: value.level,
    title,
    content,
    minAppVersion: value.minAppVersion,
    maxAppVersion: value.maxAppVersion,
    channels: value.channels,
  }
}

export function todayIdPrefix(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}`
}

export function nextId(manifest: Manifest, datePrefix: string): string {
  const max = manifest.announcements.reduce((value, item) => {
    const match = item.id.match(new RegExp(`^${datePrefix}-(\\d+)$`))
    return match ? Math.max(value, Number(match[1])) : value
  }, 0)
  if (max >= 999) throw new ApiError(409, '当日公告编号已用尽，请稍后重试。')
  return `${datePrefix}-${String(max + 1).padStart(3, '0')}`
}

export async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const serialize = (value: object): string => `${JSON.stringify(value, null, 2)}\n`
const ordered = (manifest: Manifest): Manifest => ({ ...manifest, announcements: [...manifest.announcements].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id.localeCompare(a.id)) })
const announcementPath = (id: string) => `announcements/${id}.json`

export class AnnouncementStore {
  constructor(private git: GitHubClient) {}

  async manifest(): Promise<{ data: Manifest; sha: string | null }> {
    const file = await this.git.getFile('manifest.json')
    return { data: ordered(parseManifest(file)), sha: file?.sha ?? null }
  }

  async detail(id: string): Promise<AnnouncementDetail> {
    const { data, sha } = await this.manifest()
    const entry = data.announcements.find(item => item.id === id)
    if (!entry) throw new ApiError(404, '公告不存在。')
    const file = await this.git.getFile(entry.path ?? announcementPath(id))
    if (!file) throw new ApiError(502, '公告文件不存在。')
    return { announcement: parseAnnouncement(file, id), entry, fileSha: file.sha, manifestSha: sha, actualSha256: await sha256(file.content) }
  }

  async list() {
    const { data } = await this.manifest()
    return Promise.all(data.announcements.map(async entry => {
      const file = await this.git.getFile(entry.path ?? announcementPath(entry.id))
      if (!file) throw new ApiError(502, `公告 ${entry.id} 文件不存在。`)
      const announcement = parseAnnouncement(file, entry.id)
      return { ...entry, title: announcement.title, level: announcement.level }
    }))
  }

  async create(input: AnnouncementInput): Promise<AnnouncementDetail> {
    const original = await this.manifest()
    const datePrefix = todayIdPrefix()
    let id = nextId(original.data, datePrefix)
    // Also skip orphan files left by a failed manifest commit.
    for (let attempts = 0; attempts < 999 && await this.git.getFile(announcementPath(id)); attempts++) {
      const suffix = Number(id.slice(datePrefix.length + 1)) + 1
      if (suffix > 999) throw new ApiError(409, '当日公告编号已用尽，请稍后重试。')
      id = `${datePrefix}-${String(suffix).padStart(3, '0')}`
    }
    if (await this.git.getFile(announcementPath(id))) throw new ApiError(409, '当日公告编号已用尽，请稍后重试。')
    const now = new Date().toISOString()
    const announcement: Announcement = { schemaVersion: 1, id, publishedAt: input.publishedAt, updatedAt: now, level: input.level, title: input.title, content: input.content, minAppVersion: input.minAppVersion, maxAppVersion: input.maxAppVersion, channels: input.channels }
    const content = serialize(announcement)
    const hash = await sha256(content)
    await this.git.createFile(announcementPath(id), content, `Publish announcement ${id}`)
    const latest = await this.manifest()
    if (latest.data.announcements.some(item => item.id === id)) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    const entry: ManifestEntry = { id, path: announcementPath(id), publishedAt: announcement.publishedAt, updatedAt: now, enabled: true, revision: 1, sha256: hash, minAppVersion: announcement.minAppVersion, maxAppVersion: announcement.maxAppVersion, channels: announcement.channels }
    const next = ordered({ schemaVersion: 1, announcements: [...latest.data.announcements, entry] })
    if (latest.sha) await this.git.updateFile('manifest.json', serialize(next), latest.sha, `Publish announcement ${id} in manifest`)
    else await this.git.createFile('manifest.json', serialize(next), `Initialize manifest with ${id}`)
    return this.detail(id)
  }

  async update(id: string, input: AnnouncementInput, fileSha: string, manifestSha: string | null): Promise<AnnouncementDetail> {
    const current = await this.detail(id)
    if (current.fileSha !== fileSha || current.manifestSha !== manifestSha) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    const now = new Date().toISOString()
    const announcement: Announcement = { schemaVersion: 1, id, publishedAt: input.publishedAt, updatedAt: now, level: input.level, title: input.title, content: input.content, minAppVersion: input.minAppVersion, maxAppVersion: input.maxAppVersion, channels: input.channels }
    const content = serialize(announcement)
    const hash = await sha256(content)
    await this.git.updateFile(current.entry.path ?? announcementPath(id), content, current.fileSha, `Update announcement ${id}`)
    const latest = await this.manifest()
    if (latest.sha !== manifestSha) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    const next: Manifest = ordered({ schemaVersion: 1, announcements: latest.data.announcements.map(entry => entry.id === id ? { ...entry, path: entry.path ?? announcementPath(id), publishedAt: announcement.publishedAt, updatedAt: now, revision: entry.revision + 1, sha256: hash, minAppVersion: announcement.minAppVersion, maxAppVersion: announcement.maxAppVersion, channels: announcement.channels } : entry) })
    if (!latest.sha) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    await this.git.updateFile('manifest.json', serialize(next), latest.sha, `Update announcement ${id} in manifest`)
    return this.detail(id)
  }

  async setEnabled(id: string, enabled: boolean, manifestSha: string | null): Promise<AnnouncementDetail> {
    const current = await this.manifest()
    if (!current.sha || current.sha !== manifestSha || !current.data.announcements.some(item => item.id === id)) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    const next: Manifest = { schemaVersion: 1, announcements: current.data.announcements.map(item => item.id === id ? { ...item, enabled, updatedAt: new Date().toISOString(), revision: item.revision + 1 } : item) }
    await this.git.updateFile('manifest.json', serialize(next), current.sha, `${enabled ? 'Enable' : 'Disable'} announcement ${id}`)
    return this.detail(id)
  }
}
