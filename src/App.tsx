import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody, Spinner } from '@fluentui/react-components'
import { ArrowRight20Regular, Eye20Regular, EyeOff20Regular, Megaphone24Regular, SignOut20Regular } from '@fluentui/react-icons'
import AnnouncementEditor from './AnnouncementEditor'
import AnnouncementList from './AnnouncementList'
import { api, errorMessage, isAbort, statusOf } from './api'
import { createSession, draftKey, formPayload, isDirty, readDraft, validateForm, type AnnouncementForm, type EditorSession } from './editor-model'
import { ThemePicker } from './theme'
import type { AdminListItem, AnnouncementDetail } from './types'

type AuthState = 'checking' | 'signedIn' | 'signedOut' | 'error'
type BusyState = { kind: string; id?: string } | null
interface Confirmation { title: string; message: string; label: string; action: () => void }

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const authRef = useRef<AuthState>('checking')
  const [authAttempt, setAuthAttempt] = useState(0)
  const [authError, setAuthError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [items, setItems] = useState<AdminListItem[]>([])
  const [listState, setListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<EditorSession | null>(readDraft)
  const [editorVisible, setEditorVisible] = useState(false)
  const [editorError, setEditorError] = useState<{ message: string; status: number } | null>(null)
  const [draftStored, setDraftStored] = useState(false)
  const [busy, setBusy] = useState<BusyState>(null)
  const operationLock = useRef(false)
  const listRequest = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const changeAuth = useCallback((next: AuthState) => { authRef.current = next; setAuth(next) }, [])
  const expire = useCallback(() => {
    listRequest.current.controller?.abort()
    listRequest.current.sequence++
    changeAuth('signedOut')
    setItems([]); setListState('idle'); setListError(''); setActionError(''); setNotice('')
    setPassword('')
    setAuthError('登录已过期，请重新登录。未提交的编辑内容已保留。')
    setConfirmation(null)
  }, [changeAuth])

  useEffect(() => {
    const controller = new AbortController()
    changeAuth('checking')
    api<{ authenticated: boolean }>('/api/auth/session', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { changeAuth(data.authenticated ? 'signedIn' : 'signedOut'); setAuthError('') }
    }).catch(reason => {
      if (isAbort(reason) || controller.signal.aborted) return
      if (statusOf(reason) === 401) { changeAuth('signedOut'); setAuthError('') }
      else { changeAuth('error'); setAuthError(errorMessage(reason)) }
    })
    return () => controller.abort()
  }, [authAttempt, changeAuth])

  const loadItems = useCallback(async () => {
    if (authRef.current !== 'signedIn') return
    listRequest.current.controller?.abort()
    const controller = new AbortController()
    const sequence = ++listRequest.current.sequence
    listRequest.current.controller = controller
    setListState('loading'); setListError('')
    try {
      const result = await api<AdminListItem[]>('/api/admin/announcements', { signal: controller.signal })
      if (!Array.isArray(result)) throw new Error('公告列表响应无效，请重新加载。')
      if (sequence !== listRequest.current.sequence || authRef.current !== 'signedIn') return
      setItems(result); setListState('ready')
    } catch (reason) {
      if (isAbort(reason) || sequence !== listRequest.current.sequence) return
      if (statusOf(reason) === 401) expire()
      else { setListError(errorMessage(reason)); setListState('error') }
    }
  }, [expire])
  useEffect(() => {
    if (auth === 'signedIn') void loadItems()
    return () => { listRequest.current.controller?.abort(); listRequest.current.sequence++ }
  }, [auth, loadItems])

  useEffect(() => {
    setDraftStored(false)
    if (!editor || !isDirty(editor)) {
      try { sessionStorage.removeItem(draftKey) } catch { /* Storage can be disabled. */ }
      return
    }
    const timer = window.setTimeout(() => {
      try { sessionStorage.setItem(draftKey, JSON.stringify(editor)); setDraftStored(true) } catch { setDraftStored(false) }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [editor])
  useEffect(() => {
    if (!editor || !isDirty(editor)) return
    const preventLoss = (event: BeforeUnloadEvent) => {
      try { sessionStorage.setItem(draftKey, JSON.stringify(editor)) } catch { /* The leave confirmation still protects the draft. */ }
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [editor])

  function begin(kind: string, id?: string) {
    if (operationLock.current) return false
    operationLock.current = true
    setBusy({ kind, id })
    return true
  }
  function finish() { operationLock.current = false; setBusy(null) }
  function fail(reason: unknown) {
    if (statusOf(reason) === 401) expire()
    else setActionError(errorMessage(reason))
  }
  async function login(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password || !begin('login')) return
    setAuthError('')
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      setPassword(''); setShowPassword(false); changeAuth('signedIn')
    } catch (reason) { setAuthError(errorMessage(reason)) }
    finally { finish() }
  }
  async function logout() {
    if (!begin('logout')) return
    setActionError('')
    try {
      await api('/api/auth/logout', { method: 'POST' })
      changeAuth('signedOut'); setItems([]); setListState('idle'); setPassword(''); setNotice(''); setAuthError('')
    } catch (reason) { fail(reason) }
    finally { finish() }
  }
  function requestLogout() {
    if (editor && isDirty(editor)) setConfirmation({ title: '退出登录？', message: '草稿会保留在当前标签页中。重新登录后可以继续编辑。', label: '退出登录', action: () => void logout() })
    else void logout()
  }
  function replaceDraft(action: () => void) {
    if (operationLock.current) return
    if (editor && isDirty(editor)) setConfirmation({ title: '放弃当前草稿？', message: '开始其他公告前，需要放弃当前未提交的编辑内容。', label: '放弃并继续', action })
    else action()
  }
  function startCreate() {
    replaceDraft(() => { setEditor(createSession()); setEditorVisible(true); setEditorError(null); setActionError(''); setNotice('') })
  }
  async function openExisting(id: string, copy = false) {
    if (!begin(copy ? 'copy' : 'open', id)) return
    setActionError('')
    try {
      const result = await api<AnnouncementDetail>(`/api/admin/announcements/${id}`)
      setEditor(createSession(result, copy)); setEditorError(null); setEditorVisible(true); setNotice('')
    } catch (reason) { fail(reason) }
    finally { finish() }
  }
  function backToList() {
    if (operationLock.current) return
    if (editor && !isDirty(editor)) setEditor(null)
    setEditorVisible(false)
    void loadItems()
  }
  function discardDraft() {
    setConfirmation({ title: '放弃这份草稿？', message: '未提交的编辑内容将被丢弃，已发布的公告不会受到影响。', label: '放弃草稿', action: () => { setEditor(null); setEditorVisible(false); setEditorError(null) } })
  }
  function updateForm(update: (form: AnnouncementForm) => AnnouncementForm) {
    setEditor(current => current ? { ...current, form: update(current.form) } : null)
  }
  function upsert(result: AnnouncementDetail) {
    const item: AdminListItem = { ...result.entry, title: result.announcement.title, level: result.announcement.level }
    setItems(current => [item, ...current.filter(value => value.id !== item.id)])
  }
  async function save() {
    if (!editor || validateForm(editor.form).length || !begin('save')) return
    setEditorError(null); setActionError(''); setNotice('')
    const current = editor
    const payload = formPayload(current)
    try {
      const result = current.detail
        ? await api<AnnouncementDetail>(`/api/admin/announcements/${current.detail.announcement.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, fileSha: current.detail.fileSha, manifestSha: current.detail.manifestSha }) })
        : await api<AnnouncementDetail>('/api/admin/announcements', { method: 'POST', body: JSON.stringify(payload) })
      upsert(result); setEditor(null); setEditorVisible(false); setListState('ready')
      setNotice(current.detail ? '公告修改已保存。' : `公告 ${result.announcement.id} 已发布。`)
      void loadItems()
    } catch (reason) {
      if (statusOf(reason) === 401) expire()
      else setEditorError({ message: statusOf(reason) === 409 ? '公告或列表版本已发生变化。你的编辑内容已保留，请核对最新版本后再保存。' : errorMessage(reason), status: statusOf(reason) })
    } finally { finish() }
  }
  function reloadEditor() {
    if (!editor?.detail) return
    const id = editor.detail.announcement.id
    setConfirmation({ title: '载入最新版本？', message: '最新公告将替换当前未提交的编辑内容。也可以先返回编辑器，将内容复制为新公告。', label: '载入最新版本', action: () => void openExisting(id) })
  }
  function copyDraft() {
    if (!editor || operationLock.current) return
    const session = createSession(editor.detail, true)
    setEditor({ ...session, form: { ...editor.form, publishedAt: session.initial.publishedAt } }); setEditorError(null)
  }
  async function toggleEnabled(item: AdminListItem) {
    if (!begin('toggle', item.id)) return
    setActionError(''); setNotice('')
    try {
      const current = await api<AnnouncementDetail>(`/api/admin/announcements/${item.id}`)
      if (current.entry.enabled !== item.enabled) {
        upsert(current)
        setActionError('公告状态已被其他操作修改，列表已更新。请确认状态后重试。')
        return
      }
      const result = await api<AnnouncementDetail>(`/api/admin/announcements/${item.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled, manifestSha: current.manifestSha }) })
      upsert(result); setNotice(item.enabled ? '公告已停用，内容仍然保留。' : '公告已启用。')
      void loadItems()
    } catch (reason) { fail(reason) }
    finally { finish() }
  }
  function requestToggle(item: AdminListItem) {
    setConfirmation({ title: item.enabled ? '停用这条公告？' : '启用这条公告？', message: `「${item.title['zh-CN'] || item.id}」${item.enabled ? '将从客户端公开列表中移除，内容仍会保留。' : '将对所选渠道及版本范围内的客户端可见。'}`, label: item.enabled ? '停用公告' : '启用公告', action: () => void toggleEnabled(item) })
  }

  const dialog = <Dialog open={Boolean(confirmation)} onOpenChange={(_, data) => { if (!data.open) setConfirmation(null) }}>
    <DialogSurface><DialogBody><DialogTitle>{confirmation?.title}</DialogTitle><DialogContent>{confirmation?.message}</DialogContent><DialogActions><Button type="button" onClick={() => setConfirmation(null)}>取消</Button><Button type="button" appearance="primary" onClick={() => { const action = confirmation?.action; setConfirmation(null); action?.() }}>{confirmation?.label}</Button></DialogActions></DialogBody></DialogSurface>
  </Dialog>

  if (auth === 'checking' || auth === 'error') return <main className="session-page"><div className="session-theme"><ThemePicker /></div><div className="session-card"><div className="brand-mark">N</div>{auth === 'checking' ? <Spinner label="正在连接公告中心…" /> : <><h1>暂时无法连接</h1><p className="muted">{authError}</p><Button type="button" appearance="primary" onClick={() => setAuthAttempt(value => value + 1)}>重新连接</Button></>}</div></main>
  if (auth === 'signedOut') return <main className="login-page">
    <section className="login-story"><div className="login-brand"><span className="brand-mark">N</span><span>neo-bpsys <small>ANNOUNCEMENT CENTER</small></span></div><div className="login-story-content"><span className="eyebrow">每一次更新，都值得被看见</span><h1>清晰传达。<br />从这里开始。</h1><p>统一管理应用公告，<br />让重要的信息准确抵达。</p><div className="story-decoration" aria-hidden="true"><div><span className="decoration-dot" /><span /><span /></div><div><span className="decoration-dot" /><span /><span /></div><div><span className="decoration-dot" /><span /><span /></div></div></div><span className="login-story-footer">neo-bpsys · 公告管理控制台</span></section>
    <section className="login-form-panel"><div className="login-theme"><ThemePicker /></div><div className="login-card"><span className="eyebrow">管理员入口</span><h2>欢迎回来</h2><p className="muted">登录以继续管理公告。</p>{authError && <MessageBar intent="error"><MessageBarBody>{authError}</MessageBarBody></MessageBar>}{editor && isDirty(editor) && <p className="login-draft-note">当前标签页有未提交的草稿，登录后可以继续编辑。</p>}
      <form onSubmit={login} className="login-form"><Field label="用户名" required><Input size="large" autoComplete="username" value={username} onChange={(_, data) => setUsername(data.value)} required disabled={Boolean(busy)} /></Field><Field label="密码" required><Input size="large" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(_, data) => setPassword(data.value)} required disabled={Boolean(busy)} contentAfter={<Button type="button" appearance="transparent" size="small" icon={showPassword ? <EyeOff20Regular /> : <Eye20Regular />} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} />} /></Field><Button size="large" appearance="primary" type="submit" icon={busy ? <Spinner size="tiny" /> : <ArrowRight20Regular />} iconPosition="after" disabled={Boolean(busy)}>{busy ? '正在登录…' : '登录公告中心'}</Button></form><p className="login-footer">仅供授权管理员使用</p></div></section>
  </main>
  if (editor && editorVisible) return <><AnnouncementEditor key={editor.key} session={editor} busy={Boolean(busy)} error={editorError} draftStored={draftStored} onChange={updateForm} onBack={backToList} onSave={() => void save()} onReload={reloadEditor} onCopy={copyDraft} />{dialog}</>
  return <main className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><span className="brand-mark">N</span><div>neo-bpsys<small>公告中心</small></div></div><div className="sidebar-section-label">工作空间</div><div className="sidebar-active" aria-current="page"><Megaphone24Regular />公告管理</div><div className="sidebar-bottom"><span className="sidebar-status-dot" />管理员工作空间<small>Announcement Center</small></div></aside>
    <div className="main-workspace"><header className="topbar"><span className="topbar-title">公告中心 <span className="breadcrumb-separator">/</span><span className="breadcrumb-detail">内容管理</span></span><div className="topbar-actions"><ThemePicker /><span className="topbar-divider" /><Button type="button" appearance="subtle" icon={busy?.kind === 'logout' ? <Spinner size="tiny" /> : <SignOut20Regular />} onClick={requestLogout} disabled={Boolean(busy)}>退出登录</Button></div></header>
      <AnnouncementList items={items} state={listState} error={listError} actionError={actionError} onDismissError={() => setActionError('')} busy={busy} hasDraft={Boolean(editor && isDirty(editor))} notice={notice} onDismissNotice={() => setNotice('')} onRefresh={() => void loadItems()} onCreate={startCreate} onEdit={(id, copy) => replaceDraft(() => void openExisting(id, copy))} onToggle={requestToggle} onResume={() => setEditorVisible(true)} onDiscard={discardDraft} />
    </div>{dialog}
  </main>
}
