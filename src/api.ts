import type { Agent, Conversation, Message, Model, StreamEvent } from './types'
import { uuid } from './uuid'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
  }
}
const errorLabels: Record<number, string> = {
  400: '请求参数不正确',
  401: 'API Key 无效或已过期',
  403: '当前账号没有访问权限',
  404: '会话或智能体不存在',
  409: '智能体配置冲突',
  413: '请求内容过大',
  422: '请求参数校验失败',
  429: '请求过于频繁，请稍后重试',
  502: '北向服务暂不可用',
  503: '服务未就绪',
  504: '服务响应超时',
}
function errorMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const body = value as Record<string, unknown>
  if (typeof body.message === 'string' && body.message.trim()) return body.message
  if (
    body.message &&
    typeof body.message === 'object' &&
    typeof (body.message as Record<string, unknown>).message === 'string'
  )
    return (body.message as { message: string }).message
  if (typeof body.detail === 'string') return body.detail
  if (Array.isArray(body.detail)) {
    return body.detail
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return ''
        const issue = item as Record<string, unknown>
        if (typeof issue.msg !== 'string') return ''
        const path = Array.isArray(issue.loc)
          ? issue.loc
              .filter(
                (part, index) =>
                  (typeof part === 'string' || typeof part === 'number') &&
                  !(
                    index === 0 &&
                    ['body', 'query', 'path', 'header', 'cookie'].includes(String(part))
                  ),
              )
              .join('.')
          : ''
        // Only show field locations and messages; validation input can contain private data.
        return path ? `${path}：${issue.msg}` : issue.msg
      })
      .filter(Boolean)
      .join('；')
  }
  if (body.detail && typeof body.detail === 'object') {
    const message = (body.detail as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return ''
}
async function check(response: Response) {
  if (response.ok) return response
  let detail = ''
  let code: string | undefined
  let details: unknown
  try {
    const value = await response.json()
    detail = errorMessage(value)
    if (value && typeof value === 'object') {
      code = typeof value.code === 'string' ? value.code : undefined
      details = value.details
    }
  } catch {
    detail = response.statusText
  }
  throw new ApiError(
    response.status,
    `${errorLabels[response.status] || '请求失败'}${detail ? `：${detail}` : ''}`,
    code,
    details,
  )
}
export async function request(path: string, init?: RequestInit) {
  const response = await check(
    await fetch(path, { ...init, signal: init?.signal || AbortSignal.timeout(30_000) }),
  )
  return response.json()
}
const unwrap = (value: any) => value?.data ?? value
function array(value: any, key: string): any[] {
  const data = unwrap(value)
  const result = Array.isArray(data) ? data : data?.[key]
  if (!Array.isArray(result)) throw new Error(`接口返回的 ${key} 格式不符合预期，请核对服务版本。`)
  return result
}
export const api = {
  config: () =>
    request('/api/config') as Promise<{
      configured: boolean
      agentName: string
      conversationDeleteConfigured?: boolean
    }>,
  health: () => request('/nb/v1/health'),
  async agents(): Promise<Agent[]> {
    return array(await request('/nb/v1/agents'), 'agents')
      .map((a) => ({
        name: a.name || a.agent_name,
        display_name: a.display_name || a.name || a.agent_name,
      }))
      .filter((a) => a.name)
  },
  async models(): Promise<Model[]> {
    return array(await request('/nb/v1/models'), 'models')
      .filter((m) => m.model_type === 'llm' && m.connect_status === 'available')
      .map((m) => ({
        id: Number(m.model_id ?? m.id),
        name: m.display_name || m.model_name || m.name,
      }))
      .filter((m) => Number.isInteger(m.id) && m.name)
  },
  async conversations(): Promise<Conversation[]> {
    return array(await request('/nb/v1/conversations'), 'conversations')
      .map((c) => ({
        id: Number(c.conversation_id),
        title: c.conversation_title || '未命名对话',
        time: Number(c.update_time || c.create_time) || Date.now(),
      }))
      .filter((c) => Number.isInteger(c.id))
  },
  async history(id: number): Promise<Message[]> {
    return array(await request(`/nb/v1/conversations/${id}`), 'history')
      .filter((m) => ['user', 'assistant'].includes(m.role))
      .map((m) => ({
        id: uuid(),
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        attachments: m.minio_files || [],
      }))
  },
  rename: (id: number, title: string) =>
    request(`/nb/v1/conversations/${id}/title?title=${encodeURIComponent(title)}`, {
      method: 'PUT',
    }),
  async deleteConversation(id: number) {
    const result = await request(`/api/conversations/${id}`, { method: 'DELETE' })
    if (result?.code !== 0 || result.data !== true)
      throw new Error('服务未确认删除成功，请刷新历史核实。')
  },
  stop: (id: number) => request(`/nb/v1/chat/stop/${id}`),
}

// Line-based framing preserves UTF-8 chunks, CRLF, multiline data, comments and EOF.
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let doneEvent = false
  function dispatch() {
    const payload = data.join('\n')
    data = []
    if (!payload.trim()) return
    if (payload.trim() === '[DONE]') {
      doneEvent = true
      return
    }
    let event: StreamEvent
    try {
      event = JSON.parse(payload)
    } catch {
      throw new Error('服务返回了无法解析的流式消息。')
    }
    onEvent(event)
    // agent_finish also marks sub-agent completion; only [DONE] terminates the transport.
  }
  function line(value: string) {
    if (!value) dispatch()
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''))
  }
  try {
    while (!doneEvent) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0 && !doneEvent) {
        line(buffer.slice(0, end).replace(/\r$/, ''))
        buffer = buffer.slice(end + 1)
      }
      if (done) {
        if (buffer) line(buffer.replace(/\r$/, ''))
        dispatch()
        break
      }
    }
    return doneEvent
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
export function eventText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const data = content as Record<string, unknown>
    for (const key of ['text', 'content', 'answer', 'final_answer', 'message', 'error'])
      if (typeof data[key] === 'string') return data[key] as string
  }
  return ''
}
export async function runChat(
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
) {
  const response = await check(
    await fetch('/nb/v1/chat/run', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Idempotency-Key': uuid(),
      },
      body: JSON.stringify(payload),
    }),
  )
  const id = response.headers.get('conversation_id')
  if (id && /^\d+$/.test(id))
    onEvent({ type: 'conversation_created', content: { conversation_id: Number(id) } })
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new Error('服务没有返回 SSE 流，请检查代理配置。')
  return readSSE(response.body, onEvent)
}
