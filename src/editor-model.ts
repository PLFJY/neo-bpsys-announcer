import { channels, languages, type AnnouncementDetail, type Channel, type Language, type Level, type Translations } from './types'

export const languageNames: Record<Language, string> = { 'zh-CN': '中文', 'en-US': 'English', 'ja-JP': '日本語' }
export const levelNames: Record<Level, string> = { info: '普通通知', warning: '重要提醒', critical: '紧急公告' }
export const channelNames: Record<Channel, string> = { release: 'Release', beta: 'Beta', preview: 'Preview' }
export const versionPattern = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/
export interface AnnouncementForm {
  publishedAt: string
  level: Level
  title: Translations
  content: Translations
  minAppVersion: string
  maxAppVersion: string
  channels: Channel[]
}
export interface EditorSession {
  key: string
  detail: AnnouncementDetail | null
  form: AnnouncementForm
  initial: AnnouncementForm
  copiedFrom?: string
}
export interface FormIssue { field: string; message: string; language?: Language }
const emptyTranslations = (): Translations => ({ 'zh-CN': '', 'en-US': '', 'ja-JP': '' })
// datetime-local deliberately uses Beijing time, independent of the browser timezone.
export const beijingInput = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 19)
export function inputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null
  const date = new Date(`${value}+08:00`)
  if (Number.isNaN(date.getTime())) return null
  const normalized = value.length === 16 ? `${value}:00` : value
  return beijingInput(date.toISOString()) === normalized ? date.toISOString() : null
}
export const dateLabel = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
export function newForm(): AnnouncementForm {
  return { publishedAt: beijingInput(new Date().toISOString()), level: 'info', title: emptyTranslations(), content: emptyTranslations(), minAppVersion: '', maxAppVersion: '', channels: [...channels] }
}
export function formFromDetail(detail: AnnouncementDetail): AnnouncementForm {
  const item = detail.announcement
  return { publishedAt: beijingInput(item.publishedAt), level: item.level, title: { ...item.title }, content: { ...item.content }, minAppVersion: item.minAppVersion ?? '', maxAppVersion: item.maxAppVersion ?? '', channels: [...item.channels] }
}
export function createSession(detail: AnnouncementDetail | null = null, copy = false): EditorSession {
  const initial = detail && !copy ? formFromDetail(detail) : newForm()
  const form = copy && detail ? { ...formFromDetail(detail), publishedAt: initial.publishedAt } : initial
  return { key: crypto.randomUUID(), detail: copy ? null : detail, form, initial, copiedFrom: copy ? detail?.announcement.id : undefined }
}
export const isDirty = (session: EditorSession) => JSON.stringify(session.form) !== JSON.stringify(session.initial)
export function validateForm(form: AnnouncementForm): FormIssue[] {
  const issues: FormIssue[] = []
  for (const lang of languages) {
    const title = Boolean(form.title[lang].trim())
    const content = Boolean(form.content[lang].trim())
    if (lang === 'zh-CN' || title || content) {
      if (!title) issues.push({ field: 'title', language: lang, message: `${languageNames[lang]}标题不能为空。` })
      if (!content) issues.push({ field: 'content', language: lang, message: `${languageNames[lang]}正文不能为空。` })
    }
  }
  if (!inputToIso(form.publishedAt)) issues.push({ field: 'publishedAt', message: '请选择有效的北京时间。' })
  if (!form.channels.length) issues.push({ field: 'channels', message: '请至少选择一个渠道。' })
  for (const field of ['minAppVersion', 'maxAppVersion'] as const) {
    if (form[field].trim() && !versionPattern.test(form[field].trim())) issues.push({ field, message: '版本格式无效，例如 3.0.0 或 3.0.0-beta.1。' })
  }
  return issues
}
export function formPayload(session: EditorSession) {
  const form = session.form
  // Preserve the original timestamp, including milliseconds, if it was not edited.
  const publishedAt = session.detail && inputToIso(form.publishedAt) === inputToIso(session.initial.publishedAt)
    ? session.detail.announcement.publishedAt : inputToIso(form.publishedAt)!
  return { ...form, publishedAt, minAppVersion: form.minAppVersion.trim() || null, maxAppVersion: form.maxAppVersion.trim() || null }
}

export const draftKey = 'neo-bpsys-editor-draft-v1'
export function readDraft(): EditorSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftKey) || 'null')
    const validForm = (form: AnnouncementForm) => form && typeof form.publishedAt === 'string' &&
      ['info', 'warning', 'critical'].includes(form.level) && ['title', 'content'].every(key => languages.every(lang => typeof (form[key as 'title' | 'content']?.[lang]) === 'string')) &&
      typeof form.minAppVersion === 'string' && typeof form.maxAppVersion === 'string' && Array.isArray(form.channels) && form.channels.every(channel => channels.includes(channel))
    if (!value || typeof value.key !== 'string' || !validForm(value.form) || !validForm(value.initial)) return null
    if (value.detail !== null && (!value.detail?.announcement?.id || typeof value.detail.fileSha !== 'string' || typeof value.detail.announcement.publishedAt !== 'string')) return null
    return value as EditorSession
  } catch { return null }
}
