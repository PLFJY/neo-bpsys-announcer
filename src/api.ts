export class RequestError extends Error {
  constructor(message: string, public status = 0) { super(message) }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    const timeout = AbortSignal.timeout(60_000)
    response = await fetch(path, {
      ...init, credentials: 'same-origin',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError') throw reason
    if (reason instanceof Error && reason.name === 'TimeoutError') throw new RequestError('请求超时，服务尚未确认操作结果。')
    throw new RequestError('网络连接失败，请检查连接后重试。')
  }
  let data: T & { error?: string }
  try { data = await response.json() }
  catch { throw new RequestError('服务返回了无效响应，请稍后重试。', response.status) }
  if (!response.ok) throw new RequestError(data.error || `请求失败（${response.status}）`, response.status)
  return data
}
export const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请稍后重试。'
export const isAbort = (reason: unknown) => reason instanceof Error && reason.name === 'AbortError'
export const statusOf = (reason: unknown) => reason instanceof RequestError ? reason.status : 0
