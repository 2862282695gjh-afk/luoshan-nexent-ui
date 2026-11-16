import { describe, expect, it, vi, afterEach } from 'vitest'
import { api, ApiError, readSSE, request, runChat } from '../src/api'
const encoder = new TextEncoder()
function stream(text: string, chunkSize = 1) {
  const bytes = encoder.encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize)
        controller.enqueue(bytes.slice(i, i + chunkSize))
      controller.close()
    },
  })
}
afterEach(() => vi.unstubAllGlobals())
describe('northbound SSE', () => {
  it('preserves Chinese UTF-8 across byte boundaries and CRLF multiline events', async () => {
    const received: unknown[] = []
    const done = await readSSE(
      stream(
        ': keepalive\r\ndata: {"type":"model_output",\r\ndata: "content":"罗山科技园"}\r\n\r\ndata: {"type":"agent_finish","content":""}\r\n\r\n',
      ),
      (e) => received.push(e),
    )
    expect(received).toEqual([
      { type: 'model_output', content: '罗山科技园' },
      { type: 'agent_finish', content: '' },
    ])
    expect(done).toBe(false)
  })
  it('flushes an EOF event but reports no terminal marker', async () => {
    const received: unknown[] = []
    expect(
      await readSSE(stream('data: {"type":"final_answer","content":"完整回复"}'), (e) =>
        received.push(e),
      ),
    ).toBe(false)
    expect(received).toEqual([{ type: 'final_answer', content: '完整回复' }])
  })
  it('accepts DONE and ignores subsequent bytes', async () => {
    const received: unknown[] = []
    expect(
      await readSSE(stream('data: [DONE]\n\ndata: invalid\n\n', 99), (e) => received.push(e)),
    ).toBe(true)
    expect(received).toEqual([])
  })
  it('keeps reading after step errors and sub-agent completion', async () => {
    const received: unknown[] = []
    const events = [
      { type: 'error', content: 'Code execution failed' },
      { type: 'agent_finish', content: '子任务结果' },
      { type: 'model_output_thinking', content: '继续推理' },
      { type: 'final_answer', content: '恢复后的完整结果' },
    ]
    expect(
      await readSSE(stream(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')), (e) =>
        received.push(e),
      ),
    ).toBe(false)
    expect(received).toEqual(events)
  })
  it('rejects malformed SSE instead of silently losing content', async () => {
    await expect(readSSE(stream('data: {invalid}\n\n'), () => {})).rejects.toThrow('无法解析')
  })
  it('sends POST with conversation id and consumes the header id', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(stream('data: {"type":"agent_finish","content":""}\n\n'), {
        headers: { 'Content-Type': 'text/event-stream', conversation_id: '42' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    const events: unknown[] = []
    await runChat(
      { query: '继续', agent_name: 'park', conversation_id: 42 },
      new AbortController().signal,
      (e) => events.push(e),
    )
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      query: '继续',
      agent_name: 'park',
      conversation_id: 42,
    })
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBeTruthy()
    expect(events[0]).toEqual({ type: 'conversation_created', content: { conversation_id: 42 } })
  })
  it('surfaces authentication failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"detail":"Invalid bearer token"}', { status: 401 })),
    )
    await expect(api.agents()).rejects.toThrow('API Key 无效或已过期')
  })
  it('normalizes real history and passes title as a query parameter', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              conversation_id: 1,
              history: [{ role: 'user', content: '你好', minio_files: [] }],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    expect((await api.history(1))[0]).toMatchObject({ role: 'user', content: '你好' })
    await api.rename(1, '合同 & 流程')
    expect(fetcher.mock.calls[1][0]).toBe(
      '/nb/v1/conversations/1/title?title=' + encodeURIComponent('合同 & 流程'),
    )
    expect(fetcher.mock.calls[1][1].method).toBe('PUT')
  })
  it('offers available chat models and excludes embeddings and speech models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                model_id: 7,
                model_name: 'qwen-plus',
                display_name: '主模型',
                model_type: 'llm',
                connect_status: 'available',
              },
              { model_id: 6, model_name: 'embedding', model_type: 'embedding' },
              { model_id: 4, model_name: 'speech', model_type: 'stt' },
              {
                model_id: 3,
                model_name: 'offline',
                model_type: 'llm',
                connect_status: 'unavailable',
              },
              { model_id: 8, model_name: 'unknown-status', model_type: 'llm' },
              {
                model_id: 9,
                model_name: 'checking',
                model_type: 'llm',
                connect_status: 'checking',
              },
              { model_id: 10, model_name: 'unknown-type', connect_status: 'available' },
            ],
          }),
        ),
      ),
    )
    expect(await api.models()).toEqual([{ id: 7, name: '主模型' }])
  })
})

describe('northbound HTTP errors', () => {
  it.each([
    [401, { message: 'Invalid bearer token' }, 'API Key 无效或已过期：Invalid bearer token'],
    [400, { detail: 'Invalid query' }, '请求参数不正确：Invalid query'],
    [
      400,
      { message: { code: 'AUTOMATION_ERROR', message: 'Missing capability' } },
      '请求参数不正确：Missing capability',
    ],
    [400, { detail: { message: 'Invalid metadata' } }, '请求参数不正确：Invalid metadata'],
    [
      422,
      {
        detail: [
          { loc: ['body', 'agent_name'], msg: 'Field required', input: { secret: 'PRIVATE' } },
          { loc: ['body', 'metadata', 'items', 0], msg: 'Input should be a valid string' },
        ],
      },
      '请求参数校验失败：agent_name：Field required；metadata.items.0：Input should be a valid string',
    ],
    [422, { detail: [null, {}, 'invalid'] }, '请求参数校验失败'],
    [413, null, '请求内容过大'],
  ])('normalizes HTTP %s without exposing validation input', async (status, body, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: Number(status) })),
    )
    await expect(request('/nb/v1/agents')).rejects.toMatchObject({ status, message })
  })

  it('preserves structured application errors on chat startup and never auto-retries', async () => {
    const details = { reason: 'METADATA_TOO_LARGE' }
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: '010107',
          message: 'Runtime metadata exceeds the maximum allowed size.',
          details,
        }),
        { status: 413 },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    const onEvent = vi.fn()
    const result = runChat(
      { query: '你好', agent_name: 'park' },
      new AbortController().signal,
      onEvent,
    )
    await expect(result).rejects.toBeInstanceOf(ApiError)
    await expect(result).rejects.toMatchObject({
      status: 413,
      code: '010107',
      details,
      message: '请求内容过大：Runtime metadata exceeds the maximum allowed size.',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('falls back cleanly for an HTML gateway response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>gateway error</html>', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
      ),
    )
    await expect(api.agents()).rejects.toThrow('北向服务暂不可用：Bad Gateway')
  })
})
