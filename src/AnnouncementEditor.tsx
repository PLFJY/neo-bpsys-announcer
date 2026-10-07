import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, Checkbox, Dropdown, Field, Input, MessageBar, MessageBarBody, Option, Spinner, Tab, TabList, Textarea } from '@fluentui/react-components'
import { ArrowLeft20Regular, Checkmark20Regular, Save20Regular } from '@fluentui/react-icons'
import MarkdownIt from 'markdown-it'
import { channels, languages, type Language, type Level } from './types'
import { channelNames, dateLabel, isDirty, languageNames, levelNames, validateForm, type AnnouncementForm, type EditorSession } from './editor-model'
import { ThemePicker } from './theme'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, index, options)
}
interface Props {
  session: EditorSession
  busy: boolean
  error: { message: string; status: number } | null
  draftStored: boolean
  onChange: (update: (form: AnnouncementForm) => AnnouncementForm) => void
  onBack: () => void
  onSave: () => void
  onReload: () => void
  onCopy: () => void
}

export default function AnnouncementEditor({ session, busy, error, draftStored, onChange, onBack, onSave, onReload, onCopy }: Props) {
  const { form, detail } = session
  const [language, setLanguage] = useState<Language>('zh-CN')
  const [view, setView] = useState('write')
  const [attempted, setAttempted] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = isDirty(session)
  const issues = attempted ? validateForm(form) : []
  const issue = (field: string) => issues.find(item => item.field === field && (!item.language || item.language === language))?.message
  const previewHtml = useMemo(() => markdown.render(form.content[language]), [form.content, language])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!busy) formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [busy])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setAttempted(true)
    const first = validateForm(form)[0]
    if (first) {
      if (first.language) setLanguage(first.language)
      if (first.field === 'content') setView('write')
      requestAnimationFrame(() => document.getElementById(`editor-${first.field}`)?.focus())
      return
    }
    onSave()
  }

  return <main className="editor-page">
    <header className="editor-topbar">
      <Button type="button" appearance="subtle" icon={<ArrowLeft20Regular />} onClick={onBack} disabled={busy}>返回列表</Button>
      <span className="editor-topbar-context">neo-bpsys <span>/</span> 公告编辑</span>
      <ThemePicker />
    </header>
    <form ref={formRef} onSubmit={submit} noValidate>
      <div className="editor-heading">
        <div><div className="eyebrow">{detail ? detail.announcement.id : session.copiedFrom ? `复制自 ${session.copiedFrom}` : 'NEW ANNOUNCEMENT'}</div>
          <h1>{detail ? '编辑公告' : '创建公告'}</h1>
          <p className="muted">{detail ? `修订 ${detail.entry.revision} · 上次更新于 ${dateLabel(detail.announcement.updatedAt)}` : '写好内容，选择受众，然后发布。'}</p>
        </div>
        {detail && <Badge appearance="tint" color={detail.entry.enabled ? 'success' : 'subtle'}>{detail.entry.enabled ? '已启用' : '已停用'}</Badge>}
      </div>
      <div className="editor-layout">
        <section className="editor-content" aria-label="公告内容">
          {error && <MessageBar intent="error" className="editor-error"><MessageBarBody>
            <div>{error.message}</div>
            {error.status === 409 && <div className="error-actions"><Button type="button" size="small" onClick={onReload} disabled={busy}>载入最新版本</Button><Button type="button" size="small" onClick={onCopy} disabled={busy}>复制为新公告</Button></div>}
            {(error.status === 0 || error.status >= 500) && <p>内容已保留。若发布结果尚未确认，请先返回列表检查，再决定是否重试。</p>}
          </MessageBarBody></MessageBar>}
          {detail && detail.actualSha256 !== detail.entry.sha256 && <MessageBar intent="warning"><MessageBarBody>正文与已发布版本不一致。请核对内容后保存，以修复公告。</MessageBarBody></MessageBar>}
          <div className="surface content-surface">
            <div className="content-language-header">
              <TabList aria-label="内容语言" selectedValue={language} onTabSelect={(_, data) => setLanguage(data.value as Language)}>
                {languages.map(lang => <Tab key={lang} value={lang} icon={form.title[lang].trim() && form.content[lang].trim() ? <Checkmark20Regular /> : undefined}>{languageNames[lang]}{attempted && issues.some(item => item.language === lang) && <span className="tab-error" aria-label="有待修正的字段">●</span>}</Tab>)}
              </TabList>
            </div>
            <fieldset disabled={busy} className="content-fields">
              <p className="field-hint language-hint">{language === 'zh-CN' ? '中文标题与正文必填。' : '可选翻译；填写时，请同时提供标题和正文。'}</p>
              <Field label="公告标题" required={language === 'zh-CN'} validationMessage={issue('title')} validationState={issue('title') ? 'error' : 'none'}>
                <Input id="editor-title" size="large" placeholder="用一句话概括这条公告" value={form.title[language]} onChange={(_, data) => onChange(current => ({ ...current, title: { ...current.title, [language]: data.value } }))} />
              </Field>
              <div className="body-heading"><label htmlFor="editor-content">正文 <span className="muted">· Markdown</span>{language === 'zh-CN' && <span className="required-mark"> *</span>}</label>
                <TabList size="small" appearance="subtle" aria-label="正文视图" selectedValue={view} onTabSelect={(_, data) => setView(String(data.value))}>
                  <Tab value="write">编辑</Tab><Tab value="preview">预览</Tab><Tab value="split" className="split-tab">对照</Tab>
                </TabList>
              </div>
              <div className={`body-workspace view-${view}`}>
                {view !== 'preview' && <Field validationMessage={issue('content')} validationState={issue('content') ? 'error' : 'none'} className="body-input-field">
                  <Textarea id="editor-content" aria-label={`${languageNames[language]}公告正文`} resize="vertical" placeholder={'在这里编写公告内容…\n\n支持标题、列表、链接和代码块。'} value={form.content[language]} onChange={(_, data) => onChange(current => ({ ...current, content: { ...current.content, [language]: data.value } }))} className="markdown-input" />
                </Field>}
                {view !== 'write' && <section className="preview-pane" aria-label="公告预览">
                  <div className="preview-label">内容预览</div>
                  <h2 className="preview-title">{form.title[language].trim() || '公告标题'}</h2>
                  {form.content[language].trim() ? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <p className="preview-placeholder">写入正文后，预览会显示在这里。</p>}
                </section>}
              </div>
              <p className="field-hint">支持标准 Markdown，HTML 会作为普通文本显示。预览中的链接将在新标签页打开。</p>
            </fieldset>
          </div>
        </section>
        <aside className="editor-settings" aria-label="发布设置">
          <div className="surface settings-surface">
            <h2>发布设置</h2><p className="field-hint">设置通知级别和可见范围。</p>
            <fieldset disabled={busy}>
              <Field label="通知级别"><Dropdown aria-label="通知级别" value={levelNames[form.level]} selectedOptions={[form.level]} disabled={busy} onOptionSelect={(_, data) => onChange(current => ({ ...current, level: data.optionValue as Level }))}>
                {(['info', 'warning', 'critical'] as const).map(level => <Option key={level} value={level}>{levelNames[level]}</Option>)}
              </Dropdown></Field>
              <Field label="发布时间" validationMessage={issue('publishedAt')} validationState={issue('publishedAt') ? 'error' : 'none'} hint="北京时间 · UTC+8">
                <Input id="editor-publishedAt" type="datetime-local" step="1" value={form.publishedAt} onChange={(_, data) => onChange(current => ({ ...current, publishedAt: data.value }))} />
              </Field>
              <div className="channel-field"><div className="field-label" id="channel-heading">发布渠道<span className="required-mark"> *</span></div>
                <div className="channel-options" role="group" aria-labelledby="channel-heading" aria-describedby={issue('channels') ? 'channels-error channels-hint' : 'channels-hint'}>{channels.map((channel, index) => <Checkbox id={index === 0 ? 'editor-channels' : `editor-channel-${channel}`} key={channel} label={channelNames[channel]} checked={form.channels.includes(channel)} onChange={(_, data) => onChange(current => ({ ...current, channels: channels.filter(value => value === channel ? Boolean(data.checked) : current.channels.includes(value)) }))} />)}</div>
                {issue('channels') && <p id="channels-error" className="field-error" role="alert">{issue('channels')}</p>}
                <p className="field-hint" id="channels-hint">只有所选渠道的客户端能看到公告。</p>
              </div>
              <div className="settings-divider" />
              <h3>应用版本范围</h3><p className="field-hint">留空表示不限制该端版本。</p>
              <Field label="最低版本" validationMessage={issue('minAppVersion')} validationState={issue('minAppVersion') ? 'error' : 'none'}><Input id="editor-minAppVersion" placeholder="例如 3.0.0" value={form.minAppVersion} onChange={(_, data) => onChange(current => ({ ...current, minAppVersion: data.value }))} /></Field>
              <Field label="最高版本" validationMessage={issue('maxAppVersion')} validationState={issue('maxAppVersion') ? 'error' : 'none'}><Input id="editor-maxAppVersion" placeholder="不限制" value={form.maxAppVersion} onChange={(_, data) => onChange(current => ({ ...current, maxAppVersion: data.value }))} /></Field>
            </fieldset>
          </div>
          {detail && !detail.entry.enabled && <div className="setting-note">保存修改会保留停用状态。需要展示给客户端时，请返回列表启用公告。</div>}
        </aside>
      </div>
      <footer className="editor-footer">
        <div className="save-state" role="status">{busy ? <><Spinner size="tiny" />正在保存，请稍候…</> : dirty ? <><span className="draft-dot" />{draftStored ? '草稿已暂存于当前标签页' : '有未提交的修改'}</> : <><Checkmark20Regular />{detail ? '所有修改已保存' : '填写内容以开始'}</>}</div>
        <div className="footer-actions"><Button type="button" onClick={onBack} disabled={busy}>返回列表</Button><Button type="submit" appearance="primary" icon={busy ? <Spinner size="tiny" /> : <Save20Regular />} disabled={busy || (Boolean(detail) && !dirty)}>{busy ? '保存中…' : detail ? '保存修改' : '发布公告'}</Button></div>
      </footer>
    </form>
  </main>
}
