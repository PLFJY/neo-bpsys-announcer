import { expect, test, type Page } from '@playwright/test'

function fixture() {
  const detail = (id: string, enabled: boolean, title: string) => ({
    announcement: { schemaVersion: 1, id, publishedAt: '2026-10-07T13:22:00.123Z', updatedAt: '2026-10-07T15:58:28.104Z', level: 'info', title: { 'zh-CN': title, 'en-US': '', 'ja-JP': '' }, content: { 'zh-CN': '## 更新说明\n\n测试公告内容。', 'en-US': '', 'ja-JP': '' }, minAppVersion: '3.0.0', maxAppVersion: null, channels: ['preview'] },
    entry: { id, path: `announcements/${id}.json`, publishedAt: '2026-10-07T13:22:00.123Z', updatedAt: '2026-10-07T15:58:28.104Z', enabled, revision: 2, sha256: 'a'.repeat(64), minAppVersion: '3.0.0', maxAppVersion: null, channels: ['preview'] },
    fileSha: `file-${id}`, manifestSha: 'manifest-1', actualSha256: 'a'.repeat(64),
  })
  return { authenticated: true, failSession: false, failList: false, failLogout: false, conflict: false, expireSave: false, failRefreshAfterSave: false, postCount: 0, patchCount: 0, savedPayload: null as Record<string, unknown> | null, details: [detail('20261007-001', true, '应用更新说明'), detail('20261007-002', false, '维护提醒')] }
}
async function mockApi(page: Page, state = fixture()) {
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const reply = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/api/auth/session') return reply(state.failSession ? { error: '服务暂时不可用。' } : { authenticated: state.authenticated }, state.failSession ? 503 : state.authenticated ? 200 : 401)
    if (path === '/api/auth/login') { state.authenticated = true; return reply({ authenticated: true }) }
    if (path === '/api/auth/logout') {
      if (state.failLogout) return reply({ error: '退出登录失败，请重试。' }, 502)
      state.authenticated = false; return reply({ authenticated: false })
    }
    if (!state.authenticated) return reply({ error: '登录已过期。' }, 401)
    if (path === '/api/admin/announcements' && method === 'GET') return state.failList ? reply({ error: '无法读取公告，请重试。' }, 502) : reply(state.details.map(detail => ({ ...detail.entry, title: detail.announcement.title, level: detail.announcement.level })))
    if (path === '/api/admin/announcements' && method === 'POST') {
      state.postCount++
      await new Promise(resolve => setTimeout(resolve, 150))
      state.savedPayload = request.postDataJSON()
      const created = structuredClone(state.details[0])
      created.announcement = { ...created.announcement, ...state.savedPayload, id: '20261008-001' }
      created.entry = { ...created.entry, ...state.savedPayload, id: '20261008-001', enabled: true, revision: 1 }
      state.details.unshift(created)
      if (state.failRefreshAfterSave) state.failList = true
      return reply(created)
    }
    const detail = state.details.find(item => item.announcement.id === path.split('/').at(-1))
    if (!detail) return reply({ error: '不存在。' }, 404)
    if (method === 'GET') return reply(detail)
    if (method === 'PUT') {
      if (state.expireSave) { state.authenticated = false; return reply({ error: '登录已过期。' }, 401) }
      if (state.conflict) return reply({ error: '版本冲突。' }, 409)
      state.savedPayload = request.postDataJSON()
      detail.announcement = { ...detail.announcement, ...state.savedPayload }
      detail.entry.revision++
      if (state.failRefreshAfterSave) state.failList = true
      return reply(detail)
    }
    if (method === 'PATCH') { state.patchCount++; detail.entry.enabled = request.postDataJSON().enabled; return reply(detail) }
    return reply({ error: '不支持。' }, 405)
  })
  await page.goto('/')
  return state
}
async function newDraft(page: Page) {
  await page.getByRole('button', { name: '创建公告', exact: true }).first().click()
  await page.getByLabel('公告标题').fill('新的产品更新')
  await page.getByRole('textbox', { name: '中文公告正文' }).fill('## 新功能\n\n欢迎使用。')
}

test('登录状态检查失败提供重试，不伪装成未登录', async ({ page }) => {
  const state = fixture(); state.failSession = true
  await mockApi(page, state)
  await expect(page.getByRole('heading', { name: '暂时无法连接' })).toBeVisible()
  await expect(page.getByLabel('用户名')).toHaveCount(0)
  state.failSession = false
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByRole('heading', { name: '公告管理' })).toBeVisible()
})

test('登录页提供主题切换与密码可见性，登录成功后进入列表', async ({ page }) => {
  const state = fixture(); state.authenticated = false
  await mockApi(page, state)
  await page.getByRole('button', { name: '外观：跟随系统' }).click()
  await page.getByRole('menuitemradio', { name: '深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('用户名').fill('test-admin')
  await page.getByLabel(/^密码/).fill('local-test-only')
  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(page.getByLabel(/^密码/)).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: '登录公告中心' }).click()
  await expect(page.getByRole('heading', { name: '公告管理' })).toBeVisible()
})

test('主题持久化，并实时跟随系统改变', async ({ page }) => {
  await mockApi(page)
  await page.getByRole('button', { name: '外观：跟随系统' }).click()
  await page.getByRole('menuitemradio', { name: '深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.getByRole('button', { name: '外观：深色模式' })).toBeVisible()
  await page.getByRole('button', { name: '外观：深色模式' }).click()
  await page.getByRole('menuitemradio', { name: '跟随系统' }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('加载失败不显示空列表，搜索与状态筛选能恢复', async ({ page }) => {
  const state = fixture(); state.failList = true
  await mockApi(page, state)
  await expect(page.getByRole('heading', { name: '暂时无法加载公告' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '从第一条公告开始' })).toHaveCount(0)
  state.failList = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.locator('.announcement-row')).toHaveCount(2)
  await page.getByLabel('搜索公告').fill('维护')
  await expect(page.locator('.announcement-row')).toHaveCount(1)
  await page.getByRole('tab', { name: '已启用', exact: true }).click()
  await expect(page.getByRole('heading', { name: '没有找到符合条件的公告' })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.locator('.announcement-row')).toHaveCount(2)
})

test('返回列表和刷新保留草稿，放弃需要明确确认', async ({ page }) => {
  await mockApi(page)
  await newDraft(page)
  await expect(page.locator('.save-state')).toContainText('草稿已暂存')
  await page.getByRole('button', { name: '返回列表', exact: true }).first().click()
  await expect(page.getByText('你有一份未提交的草稿')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.getByLabel('公告标题')).toHaveValue('新的产品更新')
  await page.getByRole('button', { name: '返回列表', exact: true }).first().click()
  await page.getByRole('button', { name: '放弃', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByText('你有一份未提交的草稿')).toBeVisible()
  await page.getByRole('button', { name: '放弃', exact: true }).click()
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click()
  await expect(page.getByText('你有一份未提交的草稿')).toHaveCount(0)
})

test('跨语言校验定位缺失字段，双击发布只发送一次', async ({ page }) => {
  const state = await mockApi(page)
  await newDraft(page)
  await page.getByRole('tab', { name: 'English', exact: true }).click()
  await page.getByLabel('公告标题').fill('Product update')
  await page.getByRole('button', { name: '发布公告', exact: true }).click()
  await expect(page.getByText('English正文不能为空。')).toBeVisible()
  expect(state.postCount).toBe(0)
  await page.getByRole('textbox', { name: 'English公告正文' }).fill('Update details')
  await page.getByRole('button', { name: '发布公告', exact: true }).dblclick()
  await expect(page.getByText('公告 20261008-001 已发布。')).toBeVisible()
  expect(state.postCount).toBe(1)
  await expect(page.getByText('你有一份未提交的草稿')).toHaveCount(0)
})

test('北京时间独立于浏览器时区，普通编辑保留原始时间精度', async ({ page }) => {
  const state = await mockApi(page)
  await page.getByRole('button', { name: '应用更新说明', exact: true }).click()
  await expect(page.getByLabel('发布时间')).toHaveValue('2026-10-07T21:22')
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  await page.getByLabel('公告标题').fill('应用更新说明修订')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByText('公告修改已保存。')).toBeVisible()
  expect(state.savedPayload?.publishedAt).toBe('2026-10-07T13:22:00.123Z')
})

test('保存成功但刷新失败，保留成功反馈和已更新的内容', async ({ page }) => {
  const state = await mockApi(page); state.failRefreshAfterSave = true
  await page.getByRole('button', { name: '应用更新说明', exact: true }).click()
  await page.getByLabel('公告标题').fill('已经成功保存的内容')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByText('公告修改已保存。')).toBeVisible()
  await expect(page.getByRole('button', { name: '已经成功保存的内容', exact: true })).toBeVisible()
  await expect(page.getByText('无法读取公告，请重试。')).toBeVisible()
})

test('版本冲突保留编辑内容，可以明确复制为新公告', async ({ page }) => {
  const state = await mockApi(page); state.conflict = true
  await page.getByRole('button', { name: '应用更新说明', exact: true }).click()
  await page.getByLabel('公告标题').fill('保留我的冲突草稿')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByText('公告或列表版本已发生变化。', { exact: false })).toBeVisible()
  await expect(page.getByLabel('公告标题')).toHaveValue('保留我的冲突草稿')
  await page.getByRole('button', { name: '载入最新版本', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '复制为新公告', exact: true }).click()
  await expect(page.getByRole('heading', { name: '创建公告', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '发布公告', exact: true }).click()
  expect(state.postCount).toBe(1)
})

test('登录过期后重新登录仍保留正在编辑的内容', async ({ page }) => {
  const state = await mockApi(page); state.expireSave = true
  await page.getByRole('button', { name: '应用更新说明', exact: true }).click()
  await page.getByLabel('公告标题').fill('过期后继续编辑')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await page.getByLabel('用户名').fill('test-admin')
  await page.getByLabel(/^密码/).fill('local-test-only')
  await page.getByRole('button', { name: '登录公告中心' }).click()
  await expect(page.getByLabel('公告标题')).toHaveValue('过期后继续编辑')
})

test('退出失败保留登录界面状态，状态切换需要确认', async ({ page }) => {
  const state = await mockApi(page); state.failLogout = true
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '公告管理' })).toBeVisible()
  await expect(page.getByText('退出登录失败，请重试。')).toBeVisible()
  await page.getByRole('button', { name: '更多操作：应用更新说明' }).click()
  await page.getByRole('menuitem', { name: '停用公告' }).click()
  expect(state.patchCount).toBe(0)
  await page.getByRole('button', { name: '停用公告', exact: true }).click()
  await expect(page.getByText('公告已停用，内容仍然保留。')).toBeVisible()
  expect(state.patchCount).toBe(1)
})

test('移动端列表和编辑器无横向溢出，深浅主题均可使用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await expect(page.locator('.announcement-row')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: 'test-results/mobile-list.png', fullPage: true })
  await newDraft(page)
  await expect(page.getByRole('checkbox', { name: 'Release', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Beta', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Preview', exact: true })).toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '外观：跟随系统' }).click()
  await page.getByRole('menuitemradio', { name: '深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ animations: 'disabled', path: 'test-results/mobile-editor-dark.png', fullPage: true })
})

test('桌面预览支持安全链接和对照视图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await page.screenshot({ animations: 'disabled', path: 'test-results/desktop-list-light.png', fullPage: true })
  await newDraft(page)
  await page.getByRole('textbox', { name: '中文公告正文' }).fill('## 更新\n\n[官网](https://example.com)\n\n<script>alert(1)</script>')
  await page.getByRole('tab', { name: '对照', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '中文公告正文' })).toBeVisible()
  const link = page.getByRole('link', { name: '官网' })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(page.locator('.markdown-preview script')).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', path: 'test-results/desktop-editor-light.png', fullPage: true })
  await page.getByRole('button', { name: '外观：跟随系统' }).click()
  await page.getByRole('menuitemradio', { name: '深色模式' }).click()
  await page.screenshot({ animations: 'disabled', path: 'test-results/desktop-editor-dark.png', fullPage: true })
})
