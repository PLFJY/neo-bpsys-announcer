import { expect, test } from '@playwright/test'
import { GitHubClient } from '../worker/github'
import worker from '../worker/index'

test.describe('GitHub 公告源', () => {
  test.describe.configure({ mode: 'serial' })
  const originalFetch = globalThis.fetch
  test.afterEach(() => { globalThis.fetch = originalFetch })

  test('读取指定分支，Token 只在请求头传递，中文正文可解码', async () => {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api.github.com')
      expect(url.pathname).toBe('/repos/PLFJY/neo-bpsys-announce-source/contents/announcements/%E4%B8%AD%E6%96%87.json')
      expect(url.searchParams.get('ref')).toBe('release/announcements')
      expect(url.searchParams.has('access_token')).toBe(false)
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer test-token')
      expect(headers.get('User-Agent')).toBe('neo-bpsys-announcer')
      expect(headers.get('X-GitHub-Api-Version')).toBe('2022-11-28')
      return Response.json({ encoding: 'base64', content: Buffer.from('中文公告 🎉').toString('base64'), sha: 'file-sha' })
    }
    const client = new GitHubClient('test-token', 'PLFJY', 'neo-bpsys-announce-source', 'release/announcements')
    expect(await client.getFile('announcements/中文.json')).toEqual({ content: '中文公告 🎉', sha: 'file-sha' })
  })

  test('新建和更新都使用 PUT，更新传入原文件 SHA', async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = async (_input, init) => {
      expect(init?.method).toBe('PUT')
      const body = JSON.parse(String(init?.body))
      expect(body.branch).toBe('main')
      expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('公告内容\n')
      bodies.push(body)
      return Response.json({}, { status: bodies.length === 1 ? 201 : 200 })
    }
    const client = new GitHubClient('test-token', 'PLFJY', 'neo-bpsys-announce-source', 'main')
    await client.createFile('manifest.json', '公告内容\n', 'Create manifest')
    await client.updateFile('manifest.json', '公告内容\n', 'old-sha', 'Update manifest')
    expect(bodies[0]).not.toHaveProperty('sha')
    expect(bodies[0].message).toBe('Create manifest')
    expect(bodies[1].sha).toBe('old-sha')
    expect(bodies[1].message).toBe('Update manifest')
  })

  test('区分不存在的文件、写入冲突与凭据错误', async () => {
    const client = new GitHubClient('test-token', 'PLFJY', 'neo-bpsys-announce-source', 'main')
    globalThis.fetch = async () => new Response(null, { status: 404 })
    expect(await client.getFile('manifest.json')).toBeNull()
    await expect(client.createFile('manifest.json', '{}', 'Create')).rejects.toMatchObject({ status: 502 })
    globalThis.fetch = async () => new Response(null, { status: 409 })
    await expect(client.updateFile('manifest.json', '{}', 'stale-sha', 'Update')).rejects.toMatchObject({ status: 409 })
    globalThis.fetch = async () => new Response(null, { status: 401 })
    await expect(client.getFile('manifest.json')).rejects.toMatchObject({ status: 502, message: 'GitHub 凭据无效或没有仓库权限。' })
  })

  test('Worker 默认读取目标 GitHub 仓库，缺少新 Token 返回配置错误', async () => {
    const request = new Request('https://announcer.example/api/public/v1/manifest')
    const missing = await worker.fetch(request, {} as never)
    expect(missing.status).toBe(503)
    expect(await missing.json()).toEqual({ error: 'GitHub Token 尚未配置。' })
    globalThis.fetch = async input => {
      expect(String(input)).toBe('https://api.github.com/repos/PLFJY/neo-bpsys-announce-source/contents/manifest.json?ref=main')
      return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify({ schemaVersion: 1, announcements: [] })).toString('base64'), sha: 'manifest-sha' })
    }
    const response = await worker.fetch(request, { GITHUB_TOKEN: 'test-token' } as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ schemaVersion: 1, announcements: [] })
  })
})
