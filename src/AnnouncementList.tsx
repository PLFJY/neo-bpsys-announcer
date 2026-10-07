import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, Option, Spinner, Tab, TabList } from '@fluentui/react-components'
import { Add20Regular, ArrowClockwise20Regular, Copy20Regular, Dismiss20Regular, Edit20Regular, MoreHorizontal20Regular, Search20Regular, Megaphone24Regular } from '@fluentui/react-icons'
import { channels, type AdminListItem } from './types'
import { channelNames, dateLabel, levelNames } from './editor-model'

interface Props {
  items: AdminListItem[]
  state: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  actionError: string
  onDismissError: () => void
  busy: { kind: string; id?: string } | null
  hasDraft: boolean
  notice: string
  onDismissNotice: () => void
  onRefresh: () => void
  onCreate: () => void
  onEdit: (id: string, copy?: boolean) => void
  onToggle: (item: AdminListItem) => void
  onResume: () => void
  onDiscard: () => void
}

export default function AnnouncementList({ items, state, error, actionError, onDismissError, busy, hasDraft, notice, onDismissNotice, onRefresh, onCreate, onEdit, onToggle, onResume, onDiscard }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [channel, setChannel] = useState('all')
  const [sort, setSort] = useState('publishedAt')
  const enabled = items.filter(item => item.enabled).length
  const filtered = useMemo(() => items.filter(item => {
    const text = `${item.id} ${Object.values(item.title).join(' ')}`.toLocaleLowerCase()
    return text.includes(search.trim().toLocaleLowerCase()) && (status === 'all' || item.enabled === (status === 'enabled')) && (channel === 'all' || item.channels.includes(channel as typeof channels[number]))
  }).sort((a, b) => Date.parse(sort === 'updatedAt' ? b.updatedAt : b.publishedAt) - Date.parse(sort === 'updatedAt' ? a.updatedAt : a.publishedAt) || b.id.localeCompare(a.id)), [items, search, status, channel, sort])
  const hasFilters = Boolean(search || status !== 'all' || channel !== 'all')
  const reset = () => { setSearch(''); setStatus('all'); setChannel('all') }

  return <div className="dashboard-content">
    <div className="page-heading"><div><div className="eyebrow">CONTENT MANAGEMENT</div><h1>公告管理</h1><p className="muted">在这里撰写、发布和管理客户端公告。</p></div><Button type="button" appearance="primary" size="large" icon={<Add20Regular />} onClick={onCreate} disabled={Boolean(busy)}>创建公告</Button></div>
    {notice && <MessageBar intent="success" className="notice-bar"><MessageBarBody><div className="notice-content"><span>{notice}</span><Button type="button" size="small" appearance="transparent" icon={<Dismiss20Regular />} aria-label="关闭提示" onClick={onDismissNotice} /></div></MessageBarBody></MessageBar>}
    {actionError && <MessageBar intent="error" className="notice-bar"><MessageBarBody><div className="notice-content"><span>{actionError}</span><Button type="button" size="small" appearance="transparent" icon={<Dismiss20Regular />} aria-label="关闭错误提示" onClick={onDismissError} /></div></MessageBarBody></MessageBar>}
    {hasDraft && <div className="draft-banner"><div><strong>你有一份未提交的草稿</strong><span>继续完成编辑，或放弃草稿后开始新的公告。</span></div><div><Button type="button" appearance="subtle" onClick={onDiscard} disabled={Boolean(busy)}>放弃</Button><Button type="button" onClick={onResume} disabled={Boolean(busy)}>继续编辑</Button></div></div>}
    <div className="list-overview"><div><span className="overview-number">{state === 'loading' && !items.length ? '—' : items.length}</span><span>全部公告</span></div><div><span className="overview-number success-text">{state === 'loading' && !items.length ? '—' : enabled}</span><span>已启用</span></div><div><span className="overview-number">{state === 'loading' && !items.length ? '—' : items.length - enabled}</span><span>已停用</span></div><span className="overview-description">启用的公告会进入客户端公开列表。</span></div>
    <section className="surface list-surface" aria-label="公告列表" aria-busy={state === 'loading'}>
      <div className="list-toolbar"><Input aria-label="搜索公告" className="search-input" contentBefore={<Search20Regular />} placeholder="搜索标题或公告编号" value={search} onChange={(_, data) => setSearch(data.value)} contentAfter={search ? <Button type="button" size="small" appearance="transparent" icon={<Dismiss20Regular />} aria-label="清除搜索" onClick={() => setSearch('')} /> : undefined} />
        <div className="toolbar-filters"><Dropdown aria-label="筛选渠道" value={channel === 'all' ? '全部渠道' : channelNames[channel as typeof channels[number]]} selectedOptions={[channel]} onOptionSelect={(_, data) => setChannel(data.optionValue || 'all')}><Option value="all">全部渠道</Option>{channels.map(value => <Option key={value} value={value}>{channelNames[value]}</Option>)}</Dropdown>
          <Dropdown aria-label="排序方式" value={sort === 'publishedAt' ? '发布时间' : '最近更新'} selectedOptions={[sort]} onOptionSelect={(_, data) => setSort(data.optionValue || 'publishedAt')}><Option value="publishedAt">发布时间</Option><Option value="updatedAt">最近更新</Option></Dropdown>
          <Button type="button" icon={state === 'loading' ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />} aria-label="刷新公告列表" onClick={onRefresh} disabled={state === 'loading' || Boolean(busy)} /></div>
      </div>
      <div className="list-tabs"><TabList aria-label="公告状态" selectedValue={status} onTabSelect={(_, data) => setStatus(String(data.value))}><Tab value="all">全部</Tab><Tab value="enabled">已启用</Tab><Tab value="disabled">已停用</Tab></TabList><span className="result-count" role="status">{state === 'loading' ? '正在同步…' : `${filtered.length} 条公告`}</span></div>
      {error && <div className="list-error"><MessageBar intent="error"><MessageBarBody><div>{error}</div><Button type="button" size="small" onClick={onRefresh} disabled={state === 'loading' || Boolean(busy)}>重新加载</Button></MessageBarBody></MessageBar></div>}
      {(state === 'idle' || state === 'loading') && items.length === 0 ? <div className="list-loading"><Spinner label="正在加载公告…" /></div> : state === 'error' && items.length === 0 ? <div className="empty-state"><Megaphone24Regular /><h2>暂时无法加载公告</h2><p>请重新加载，已有公告不会受到影响。</p></div> : !filtered.length ? <div className="empty-state"><Megaphone24Regular /><h2>{hasFilters ? '没有找到符合条件的公告' : '从第一条公告开始'}</h2><p>{hasFilters ? '试试其他关键词，或清除筛选条件。' : '将产品更新、重要提醒及时传达给用户。'}</p><Button type="button" appearance="primary" onClick={hasFilters ? reset : onCreate} disabled={Boolean(busy)}>{hasFilters ? '清除筛选' : '创建公告'}</Button></div> : <div className="announcement-list">
        {filtered.map(item => <article key={item.id} className="announcement-row">
          <div className={`announcement-indicator level-${item.level}`} aria-hidden="true" />
          <div className="announcement-main"><div className="announcement-title-row"><button type="button" className="announcement-title" onClick={() => onEdit(item.id)} disabled={Boolean(busy)}>{item.title['zh-CN'] || item.title['en-US'] || item.id}</button><Badge appearance="tint" color={item.level === 'critical' ? 'danger' : item.level === 'warning' ? 'warning' : 'informative'}>{levelNames[item.level]}</Badge></div>
            <div className="announcement-meta"><span className="mono">{item.id}</span><span>修订 {item.revision}</span><span>{dateLabel(item.publishedAt)} <span className="timezone-label">UTC+8</span></span></div>
            <div className="announcement-audience">{item.channels.map(value => <span className="channel-tag" key={value}>{channelNames[value]}</span>)}<span className="version-label">{item.minAppVersion || item.maxAppVersion ? `${item.minAppVersion || '不限'} — ${item.maxAppVersion || '不限'}` : '所有版本'}</span></div>
          </div>
          <div className="announcement-row-actions"><span className={`status-label ${item.enabled ? 'enabled' : ''}`}><span />{item.enabled ? '已启用' : '已停用'}</span>
            <Button type="button" appearance="subtle" icon={busy?.id === item.id && (busy.kind === 'open' || busy.kind === 'copy') ? <Spinner size="tiny" /> : <Edit20Regular />} onClick={() => onEdit(item.id)} disabled={Boolean(busy)} className="edit-button">编辑</Button>
            <Menu><MenuTrigger disableButtonEnhancement><Button type="button" appearance="subtle" icon={busy?.id === item.id && busy.kind === 'toggle' ? <Spinner size="tiny" /> : <MoreHorizontal20Regular />} aria-label={`更多操作：${item.title['zh-CN'] || item.id}`} disabled={Boolean(busy)} /></MenuTrigger><MenuPopover><MenuList>
              <MenuItem icon={<Copy20Regular />} onClick={() => onEdit(item.id, true)}>复制为新公告</MenuItem><MenuItem onClick={() => onToggle(item)}>{item.enabled ? '停用公告' : '启用公告'}</MenuItem>
            </MenuList></MenuPopover></Menu>
          </div>
        </article>)}
      </div>}
    </section>
    <p className="list-footnote">{sort === 'publishedAt' ? '按发布时间从新到旧展示。' : '按最近更新时间展示。'}停用公告会保留内容与历史修订。</p>
  </div>
}
