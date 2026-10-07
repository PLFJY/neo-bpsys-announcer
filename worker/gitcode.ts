export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface GitFile { content: string; sha: string }
interface GitCodeResponse { content?: string; encoding?: string; sha?: string }

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

export class GitCodeClient {
  constructor(private token: string, private owner: string, private repo: string, private branch: string) {}

  private url(path: string): URL {
    const url = new URL(`https://api.gitcode.com/api/v5/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`)
    url.searchParams.set('access_token', this.token)
    return url
  }

  private async call(method: string, path: string, body?: object): Promise<Response> {
    let response: Response
    try {
      response = await fetch(this.url(path), {
        method,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json;charset=UTF-8' },
        body: body && JSON.stringify(body),
      })
    } catch {
      throw new ApiError(502, 'GitCode 暂时无法访问，请稍后重试。')
    }
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'GitCode 凭据无效或没有仓库权限。')
    if (response.status === 409 || response.status === 422 || (response.status === 400 && method !== 'GET')) throw new ApiError(409, '数据已被其他操作修改，请刷新后重试。')
    if (!response.ok && response.status !== 404) throw new ApiError(502, 'GitCode 操作失败，请稍后重试。')
    return response
  }

  async getFile(path: string): Promise<GitFile | null> {
    const url = this.url(path)
    url.searchParams.set('ref', this.branch)
    let response: Response
    try { response = await fetch(url, { headers: { Accept: 'application/json' } }) }
    catch { throw new ApiError(502, 'GitCode 暂时无法访问，请稍后重试。') }
    if (response.status === 404) return null
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'GitCode 凭据无效或没有仓库权限。')
    if (!response.ok) throw new ApiError(502, 'GitCode 读取失败，请稍后重试。')
    let data: GitCodeResponse
    try { data = await response.json() as GitCodeResponse }
    catch { throw new ApiError(502, 'GitCode 文件响应无效。') }
    if (data.encoding !== 'base64' || !data.content || !data.sha) throw new ApiError(502, 'GitCode 文件响应无效。')
    try { return { content: decodeBase64(data.content), sha: data.sha } }
    catch { throw new ApiError(502, 'GitCode 文件编码无效。') }
  }

  async createFile(path: string, content: string, commitMessage: string): Promise<void> {
    const response = await this.call('POST', path, { content: encodeBase64(content), message: commitMessage, branch: this.branch })
    if (!response.ok) throw new ApiError(502, 'GitCode 新建文件失败。')
  }

  async updateFile(path: string, content: string, sha: string, commitMessage: string): Promise<void> {
    const response = await this.call('PUT', path, { content: encodeBase64(content), sha, message: commitMessage, branch: this.branch })
    if (!response.ok) throw new ApiError(502, 'GitCode 更新文件失败。')
  }
}
