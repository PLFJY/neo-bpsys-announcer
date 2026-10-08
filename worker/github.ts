export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface GitFile { content: string; sha: string }
interface GitHubResponse { content?: string; encoding?: string; sha?: string }

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function decodeBase64(text: string): string {
  const binary = atob(text.replace(/\s/g, ''))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

export class GitHubClient {
  constructor(private token: string, private owner: string, private repo: string, private branch: string) {}

  private url(path: string): URL {
    return new URL(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`)
  }

  private headers(): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json;charset=UTF-8',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'neo-bpsys-announcer',
    }
  }

  private async call(method: string, path: string, body?: object): Promise<Response> {
    let response: Response
    try {
      response = await fetch(this.url(path), {
        method,
        headers: this.headers(),
        body: body && JSON.stringify(body),
      })
    } catch {
      throw new ApiError(502, 'GitHub 暂时无法访问，请稍后重试。')
    }
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'GitHub 凭据无效或没有仓库权限。')
    if (response.status === 409 || response.status === 422 || (response.status === 400 && method !== 'GET')) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    if (!response.ok && response.status !== 404) throw new ApiError(502, 'GitHub 操作失败，请稍后重试。')
    return response
  }

  async getFile(path: string): Promise<GitFile | null> {
    const url = this.url(path)
    url.searchParams.set('ref', this.branch)
    let response: Response
    try { response = await fetch(url, { headers: this.headers() }) }
    catch { throw new ApiError(502, 'GitHub 暂时无法访问，请稍后重试。') }
    if (response.status === 404) return null
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'GitHub 凭据无效或没有仓库权限。')
    if (!response.ok) throw new ApiError(502, 'GitHub 读取失败，请稍后重试。')
    let data: GitHubResponse
    try { data = await response.json() as GitHubResponse }
    catch { throw new ApiError(502, 'GitHub 文件响应无效。') }
    if (data.encoding !== 'base64' || typeof data.content !== 'string' || !data.sha) throw new ApiError(502, 'GitHub 文件响应无效。')
    try { return { content: decodeBase64(data.content), sha: data.sha } }
    catch { throw new ApiError(502, 'GitHub 文件编码无效。') }
  }

  async createFile(path: string, content: string, commitMessage: string): Promise<void> {
    const response = await this.call('PUT', path, { content: encodeBase64(content), message: commitMessage, branch: this.branch })
    if (!response.ok) throw new ApiError(502, 'GitHub 新建文件失败。')
  }

  async updateFile(path: string, content: string, sha: string, commitMessage: string): Promise<void> {
    const response = await this.call('PUT', path, { content: encodeBase64(content), sha, message: commitMessage, branch: this.branch })
    if (!response.ok) throw new ApiError(502, 'GitHub 更新文件失败。')
  }
}
