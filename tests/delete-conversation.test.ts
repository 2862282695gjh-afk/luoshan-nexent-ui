import { afterEach, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApiMiddleware } from '../server/proxy.mjs'
const servers: http.Server[] = []
async function serve(handler: http.RequestListener) {
  const s = http.createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections()
          s.close(() => r())
        }),
    ),
  )
})
async function fixture(
  options: {
    nb?: boolean
    main?: boolean
    mainBroken?: boolean
    badDelete?: boolean
    modernList?: boolean
    speed?: boolean
  } = {},
) {
  const requests: { method?: string; path?: string; auth?: string }[] = []
  const upstream = await serve((req, res) => {
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/nb/v1/conversations')
      res.end(JSON.stringify({ data: options.nb === false ? [] : [{ conversation_id: 42 }] }))
    else if (req.url === '/gateway/conversation/list?today_start_ms=0&week_start_ms=0')
      res.end(
        options.mainBroken
          ? 'malformed'
          : JSON.stringify({
              code: 0,
              data:
                options.main === false
                  ? []
                  : options.modernList
                    ? { items: [{ conversation_id: 42 }], metadata: { total: 1 } }
                    : [{ conversation_id: 42 }],
            }),
      )
    else if (req.method === 'DELETE' && req.url === '/gateway/conversation/42')
      res.end(JSON.stringify({ code: 0, data: !options.badDelete }))
    else {
      res.statusCode = 404
      res.end('{}')
    }
  })
  const proxy = await serve(
    createApiMiddleware({
      NEXENT_BASE_URL: upstream,
      NEXENT_API_KEY: 'nb-secret',
      NEXENT_MAIN_API_URL: upstream + '/gateway',
      NEXENT_USER_TOKEN: 'main-secret',
      NEXENT_AUTOMATION_AUTH_MODE: options.speed ? 'speed' : 'jwt',
    }),
  )
  return { proxy, requests }
}
it('checks both users before deleting, preserves prefixes and separates credentials', async () => {
  const { proxy, requests } = await fixture()
  const res = await fetch(proxy + '/api/conversations/42?tenant_id=other', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ code: 0, message: 'success', data: true })
  expect(requests.slice(0, 2)).toEqual(
    expect.arrayContaining([
      { method: 'GET', path: '/nb/v1/conversations', auth: 'Bearer nb-secret' },
      {
        method: 'GET',
        path: '/gateway/conversation/list?today_start_ms=0&week_start_ms=0',
        auth: 'Bearer main-secret',
      },
    ]),
  )
  expect(requests[2]).toEqual({
    method: 'DELETE',
    path: '/gateway/conversation/42',
    auth: 'Bearer main-secret',
  })
})
it.each([{ nb: false }, { main: false }])(
  'refuses a conversation outside either identity %j',
  async (options) => {
    const { proxy, requests } = await fixture(options)
    expect((await fetch(proxy + '/api/conversations/42', { method: 'DELETE' })).status).toBe(403)
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false)
  },
)
it('fails closed when ownership cannot be verified', async () => {
  const { proxy, requests } = await fixture({ mainBroken: true })
  const res = await fetch(proxy + '/api/conversations/42', { method: 'DELETE' })
  expect(res.status).toBe(502)
  expect(await res.text()).toContain('未发送删除请求')
  expect(requests.some((r) => r.method === 'DELETE')).toBe(false)
})
it('does not claim success or repeat when upstream does not confirm deletion', async () => {
  const { proxy, requests } = await fixture({ badDelete: true })
  const res = await fetch(proxy + '/api/conversations/42', { method: 'DELETE' })
  expect(res.status).toBe(502)
  expect(await res.text()).toContain('请勿重复提交')
  expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(1)
})
it('supports explicit speed mode without forwarding JWT or northbound key to main API', async () => {
  const { proxy, requests } = await fixture({ speed: true })
  expect((await fetch(proxy + '/api/conversations/42', { method: 'DELETE' })).status).toBe(200)
  expect(
    requests.filter((r) => r.path?.startsWith('/gateway')).every((r) => r.auth === undefined),
  ).toBe(true)
})
it('rejects cross-origin, unsupported methods, invalid ids and missing main configuration', async () => {
  const { proxy, requests } = await fixture()
  expect(
    (
      await fetch(proxy + '/api/conversations/42', {
        method: 'DELETE',
        headers: { Origin: 'https://other.test' },
      })
    ).status,
  ).toBe(403)
  expect((await fetch(proxy + '/api/conversations/42')).status).toBe(404)
  expect((await fetch(proxy + '/api/conversations/0', { method: 'DELETE' })).status).toBe(404)
  expect(
    (await fetch(proxy + '/api/conversations/9999999999999999999999', { method: 'DELETE' })).status,
  ).toBe(400)
  expect(requests).toHaveLength(0)
  const missing = await serve(createApiMiddleware({ NEXENT_BASE_URL: proxy, NEXENT_API_KEY: 'nb' }))
  expect((await fetch(missing + '/api/conversations/42', { method: 'DELETE' })).status).toBe(503)
})

it('accepts the newer grouped conversation list without limiting ownership to page one', async () => {
  const { proxy } = await fixture({ modernList: true })
  expect((await fetch(proxy + '/api/conversations/42', { method: 'DELETE' })).status).toBe(200)
})
