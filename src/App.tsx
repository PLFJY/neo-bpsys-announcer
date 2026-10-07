import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Badge, Button, Card, Checkbox, Dropdown, Field, Input, Menu, MenuItem, MenuList, MenuPopover,
  MenuTrigger, MessageBar, MessageBarBody, Option, OverlayDrawer, DrawerBody, DrawerFooter,
  DrawerHeader, DrawerHeaderTitle, Spinner, Tab, TabList, Text, Textarea, Title1, Title2,
} from '@fluentui/react-components'
import { Add24Regular, Dismiss24Regular, Edit20Regular, MoreHorizontal20Regular } from '@fluentui/react-icons'
import MarkdownIt from 'markdown-it'
import { channels, languages, type AdminListItem, type AnnouncementDetail, type Channel, type Language, type Level, type Translations } from './types'

const languageNames: Record<Language, string> = { 'zh-CN': '中文', 'en-US': 'English', 'ja-JP': '日本語' }
const levelNames: Record<Level, string> = { info: 'Info', warning: 'Warning', critical: 'Critical' }
const channelNames: Record<Channel, string> = { release: 'Release', beta: 'Beta', preview: 'Preview' }
const emptyTranslations = (): Translations => ({ 'zh-CN': '', 'en-US': '', 'ja-JP': '' })
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })

interface FormData {
  publishedAt: string
  level: Level
  title: Translations
  content: Translations
  minAppVersion: string
  maxAppVersion: string
  channels: Channel[]
}

const localDateTime = (value: string) => {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function newForm(): FormData {
  return { publishedAt: localDateTime(new Date().toISOString()), level: 'info', title: emptyTranslations(), content: emptyTranslations(), minAppVersion: '', maxAppVersion: '', channels: [...channels] }
}

function formFromDetail(detail: AnnouncementDetail): FormData {
  const item = detail.announcement
  return { publishedAt: localDateTime(item.publishedAt), level: item.level, title: { ...item.title }, content: { ...item.content }, minAppVersion: item.minAppVersion || '', maxAppVersion: item.maxAppVersion || '', channels: [...item.channels] }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  } catch { throw new Error('网络连接失败，请稍后重试。') }
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return data
}

const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请稍后重试。'
const isUnauthorized = (error: unknown) => error instanceof Error && 'status' in error && error.status === 401
const dateLabel = (date: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(date))

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [items, setItems] = useState<AdminListItem[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<FormData>(newForm)
  const [detail, setDetail] = useState<AnnouncementDetail | null>(null)
  const [language, setLanguage] = useState<Language>('zh-CN')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleError = useCallback((reason: unknown) => {
    if (isUnauthorized(reason)) { setAuthenticated(false); setItems([]); setDrawerOpen(false) }
    setError(message(reason))
  }, [])

  const loadItems = useCallback(async () => {
    try { setItems(await api<AdminListItem[]>('/api/admin/announcements')); setError('') }
    catch (reason) { handleError(reason) }
  }, [handleError])

  useEffect(() => {
    api('/api/auth/session').then(() => setAuthenticated(true)).catch(() => setAuthenticated(false))
  }, [])
  useEffect(() => { if (authenticated) void loadItems() }, [authenticated, loadItems])

  async function login(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      setPassword(''); setAuthenticated(true)
    } catch (reason) { handleError(reason) }
    finally { setBusy(false) }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) }
    catch (reason) { handleError(reason) }
    setAuthenticated(false); setItems([]); setDrawerOpen(false)
  }

  function startCreate() {
    setDetail(null); setForm(newForm()); setLanguage('zh-CN'); setPreview(false); setError(''); setDrawerOpen(true)
  }

  async function openExisting(id: string, copy: boolean) {
    setBusy(true); setError('')
    try {
      const loaded = await api<AnnouncementDetail>(`/api/admin/announcements/${id}`)
      setDetail(copy ? null : loaded)
      setForm(formFromDetail(loaded))
      if (copy) setForm(current => ({ ...current, publishedAt: localDateTime(new Date().toISOString()) }))
      setLanguage('zh-CN'); setPreview(false); setDrawerOpen(true)
    } catch (reason) { handleError(reason) }
    finally { setBusy(false) }
  }

  async function toggleEnabled(item: AdminListItem) {
    setBusy(true); setError(''); setNotice('')
    try {
      const loaded = await api<AnnouncementDetail>(`/api/admin/announcements/${item.id}`)
      await api(`/api/admin/announcements/${item.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled, manifestSha: loaded.manifestSha }) })
      await loadItems()
      setNotice(item.enabled ? '公告已停用。' : '公告已启用。')
    } catch (reason) { handleError(reason) }
    finally { setBusy(false) }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form.title['zh-CN'].trim() || !form.content['zh-CN'].trim()) { setError('请填写中文标题和正文。'); return }
    if (!form.channels.length) { setError('请至少选择一个渠道。'); return }
    const date = new Date(form.publishedAt)
    if (Number.isNaN(date.getTime())) { setError('发布时间无效。'); return }
    setBusy(true); setError(''); setNotice('')
    const payload = {
      publishedAt: date.toISOString(), level: form.level, title: form.title, content: form.content,
      minAppVersion: form.minAppVersion.trim() || null, maxAppVersion: form.maxAppVersion.trim() || null,
      channels: form.channels,
    }
    try {
      if (detail) {
        await api(`/api/admin/announcements/${detail.announcement.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, fileSha: detail.fileSha, manifestSha: detail.manifestSha }) })
      } else {
        await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify(payload) })
      }
      setDrawerOpen(false); await loadItems(); setNotice(detail ? '公告已更新。' : '公告已发布。')
    } catch (reason) { handleError(reason) }
    finally { setBusy(false) }
  }

  const previewHtml = useMemo(() => markdown.render(form.content[language]), [form.content, language])

  if (authenticated === null) return <div className="center-screen"><Spinner label="正在检查登录状态…" /></div>
  if (!authenticated) return (
    <main className="login-page">
      <Card className="login-card">
        <Text className="eyebrow">neo-bpsys</Text>
        <Title1>Announcement Center</Title1>
        <Text className="subtle">登录以管理应用公告</Text>
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
        <form onSubmit={login} className="stack">
          <Field label="Username" required><Input autoComplete="username" value={username} onChange={(_, data) => setUsername(data.value)} required /></Field>
          <Field label="Password" required><Input type="password" autoComplete="current-password" value={password} onChange={(_, data) => setPassword(data.value)} required /></Field>
          <Button appearance="primary" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</Button>
        </form>
      </Card>
    </main>
  )

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><Text className="brand">neo-bpsys</Text><Text className="brand-title">Announcement Center</Text></div>
        <div className="header-actions"><Button appearance="primary" icon={<Add24Regular />} onClick={startCreate}>发布公告</Button><Button appearance="subtle" onClick={() => void logout()}>退出</Button></div>
      </header>
      <section className="content">
        <div className="section-heading"><div><Title2>公告</Title2><Text className="subtle">管理发布给 neo-bpsys 客户端的消息</Text></div><Text className="count">{items.length} 条公告</Text></div>
        {error && <MessageBar intent="error" className="status"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
        {notice && <MessageBar intent="success" className="status"><MessageBarBody>{notice}</MessageBarBody></MessageBar>}
        {items.length === 0 && <Card className="empty-card"><Text>还没有公告。点击“发布公告”创建第一条。</Text></Card>}
        <div className="announcement-list">
          {items.map(item => (
            <Card key={item.id} className={`announcement-card ${item.enabled ? '' : 'disabled-card'}`}>
              <div className="card-main">
                <div className="card-title-row"><Text weight="semibold" size={500}>{item.title['zh-CN'] || item.title['en-US'] || item.id}</Text><Badge appearance="tint" color={item.level === 'critical' ? 'danger' : item.level === 'warning' ? 'warning' : 'informative'}>{levelNames[item.level]}</Badge>{!item.enabled && <Badge appearance="outline">已停用</Badge>}</div>
                <Text className="card-meta">{dateLabel(item.publishedAt)} · {item.channels.map(channel => channelNames[channel]).join(' · ')}</Text>
                <Text className="card-id">{item.id} · 修订 {item.revision}</Text>
              </div>
              <div className="card-actions"><Button appearance="subtle" icon={<Edit20Regular />} disabled={busy} onClick={() => void openExisting(item.id, false)}>编辑</Button>
                <Menu><MenuTrigger disableButtonEnhancement><Button appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="更多操作" disabled={busy} /></MenuTrigger><MenuPopover><MenuList>
                  <MenuItem onClick={() => void openExisting(item.id, false)}>编辑</MenuItem>
                  <MenuItem onClick={() => void toggleEnabled(item)}>{item.enabled ? '停用' : '启用'}</MenuItem>
                  <MenuItem onClick={() => void openExisting(item.id, true)}>复制</MenuItem>
                </MenuList></MenuPopover></Menu>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <OverlayDrawer open={drawerOpen} onOpenChange={(_, data) => setDrawerOpen(data.open)} position="end" size="large" className="editor-drawer">
        <DrawerHeader><DrawerHeaderTitle action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="关闭" onClick={() => setDrawerOpen(false)} />}>{detail ? '编辑公告' : '发布公告'}</DrawerHeaderTitle></DrawerHeader>
        <form onSubmit={save} className="drawer-form">
          <DrawerBody>
            <div className="drawer-fields">
              {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
              <Field label="类型"><Dropdown value={levelNames[form.level]} selectedOptions={[form.level]} onOptionSelect={(_, data) => setForm(current => ({ ...current, level: data.optionValue as Level }))}>{(['info', 'warning', 'critical'] as const).map(level => <Option key={level} value={level}>{levelNames[level]}</Option>)}</Dropdown></Field>
              <Field label="发布时间"><Input type="datetime-local" value={form.publishedAt} onChange={(_, data) => setForm(current => ({ ...current, publishedAt: data.value }))} required /></Field>
              <Field label="渠道"><div className="channel-options">{channels.map(channel => <Checkbox key={channel} label={channelNames[channel]} checked={form.channels.includes(channel)} onChange={(_, data) => setForm(current => ({ ...current, channels: data.checked ? [...current.channels, channel] : current.channels.filter(value => value !== channel) }))} />)}</div></Field>
              <div className="version-fields"><Field label="Min Version"><Input placeholder="例如 1.2.0" value={form.minAppVersion} onChange={(_, data) => setForm(current => ({ ...current, minAppVersion: data.value }))} /></Field><Field label="Max Version"><Input placeholder="可留空" value={form.maxAppVersion} onChange={(_, data) => setForm(current => ({ ...current, maxAppVersion: data.value }))} /></Field></div>
              <div className="language-block"><TabList selectedValue={language} onTabSelect={(_, data) => { setLanguage(data.value as Language); setPreview(false) }}>{languages.map(lang => <Tab key={lang} value={lang}>{languageNames[lang]}</Tab>)}</TabList></div>
              <Field label={`标题${language === 'zh-CN' ? ' *' : ''}`}><Input value={form.title[language]} onChange={(_, data) => setForm(current => ({ ...current, title: { ...current.title, [language]: data.value } }))} /></Field>
              <div className="markdown-heading"><Text weight="semibold">Markdown{language === 'zh-CN' ? ' *' : ''}</Text><div><Button size="small" appearance={preview ? 'subtle' : 'primary'} onClick={() => setPreview(false)}>编辑</Button><Button size="small" appearance={preview ? 'primary' : 'subtle'} onClick={() => setPreview(true)}>预览</Button></div></div>
              {preview ? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <Textarea className="markdown-input" resize="vertical" placeholder="用 Markdown 编写公告内容…" value={form.content[language]} onChange={(_, data) => setForm(current => ({ ...current, content: { ...current.content, [language]: data.value } }))} />}
            </div>
          </DrawerBody>
          <DrawerFooter><Button appearance="secondary" onClick={() => setDrawerOpen(false)}>取消</Button><Button appearance="primary" type="submit" disabled={busy}>{busy ? '保存中…' : detail ? '保存修改' : '发布公告'}</Button></DrawerFooter>
        </form>
      </OverlayDrawer>
    </main>
  )
}
