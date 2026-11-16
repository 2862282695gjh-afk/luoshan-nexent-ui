import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApiMiddleware } from '../server/proxy.mjs'
const servers: http.Server[] = []
async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections()
          s.close(() => resolve())
        }),
    ),
  )
})
describe('server-side proxy', () => {
  it('keeps credentials server-side and streams chat SSE', async () => {
    let auth = ''
    let payload = ''
    const upstream = await serve((req, res) => {
      auth = req.headers.authorization || ''
      req.setEncoding('utf8')
      req.on('data', (c) => (payload += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', conversation_id: '7' })
        res.end('data: {"type":"agent_finish","content":""}\n\n')
      })
    })
    const proxy = await serve(
      createApiMiddleware({
        NEXENT_BASE_URL: upstream,
        NEXENT_API_KEY: 'server-secret',
        NEXENT_AGENT_NAME: 'park',
      }),
    )
    const config = await (await fetch(proxy + '/api/config')).text()
    expect(config).not.toContain('server-secret')
    expect(JSON.parse(config).configured).toBe(true)
    const response = await fetch(proxy + '/nb/v1/chat/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'park', query: '你好' }),
    })
    expect(response.headers.get('conversation_id')).toBe('7')
    expect(await response.text()).toContain('agent_finish')
    expect(auth).toBe('Bearer server-secret')
    expect(JSON.parse(payload)).toEqual({ agent_name: 'park', query: '你好' })
  })
  it('only exposes allowlisted model metadata, even when upstream returns secrets', async () => {
    const upstream = await serve((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          api_key: 'envelope-secret',
          data: [
            {
              model_id: 7,
              model_name: 'qwen-plus',
              model_type: 'llm',
              connect_status: 'available',
              api_key: 'provider-secret',
              access_token: 'private-token',
              base_url: 'https://private-provider',
              future_secret: 'unknown-secret',
            },
          ],
        }),
      )
    })
    const proxy = await serve(
      createApiMiddleware({ NEXENT_BASE_URL: upstream, NEXENT_API_KEY: 'server-secret' }),
    )
    const response = await fetch(proxy + '/nb/v1/models')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        { model_id: 7, model_name: 'qwen-plus', model_type: 'llm', connect_status: 'available' },
      ],
    })
  })
  it('does not leak malformed model payloads or change upstream error status', async () => {
    let status = 200
    const upstream = await serve((_req, res) => {
      res.writeHead(status)
      res.end(status === 200 ? 'unexpected-sensitive-content' : '{"detail":"Unauthorized"}')
    })
    const proxy = await serve(
      createApiMiddleware({ NEXENT_BASE_URL: upstream, NEXENT_API_KEY: 'server-secret' }),
    )
    const invalid = await fetch(proxy + '/nb/v1/models')
    expect(invalid.status).toBe(502)
    expect(await invalid.text()).not.toContain('unexpected-sensitive-content')
    status = 401
    expect((await fetch(proxy + '/nb/v1/models')).status).toBe(401)
  })
  it('rejects admin endpoints and cross-origin credential use', async () => {
    const proxy = await serve(createApiMiddleware({}))
    expect((await fetch(proxy + '/nb/v1/api-users/batch', { method: 'POST' })).status).toBe(404)
    expect(
      (
        await fetch(proxy + '/nb/v1/chat/run', {
          method: 'POST',
          headers: { Origin: 'https://untrusted.test' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await fetch(proxy + '/nb/v1/chat/run', { method: 'POST', headers: { Origin: 'null' } }))
        .status,
    ).toBe(403)
    expect((await fetch(proxy + '/nb/v1/conversations')).status).toBe(503)
  })
})

it('routes automation APIs with a separate user JWT and preserves gateway prefixes', async () => {
  const received: { path?: string; auth?: string }[] = []
  const upstream = await serve((req, res) => {
    received.push({ path: req.url, auth: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    res.end('{"code":0,"data":{}}')
  })
  const proxy = await serve(
    createApiMiddleware({
      NEXENT_BASE_URL: upstream,
      NEXENT_API_KEY: 'northbound-only',
      NEXENT_MAIN_API_URL: upstream + '/api',
      NEXENT_USER_TOKEN: 'Bearer main-user-only',
      NEXENT_AUTOMATION_AGENT_ID: '7',
    }),
  )
  const config = await (await fetch(proxy + '/api/config')).text()
  expect(config).not.toContain('main-user-only')
  expect(config).not.toContain('northbound-only')
  expect(JSON.parse(config)).toMatchObject({ automationConfigured: true, automationAgentId: 7 })
  expect(
    (
      await fetch(proxy + '/api/automations/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"agent_id":7,"message":"每天9点巡检"}',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await fetch(proxy + '/api/automations/proposals/12/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(200)
  expect((await fetch(proxy + '/nb/v1/agents')).status).toBe(200)
  expect(received).toEqual([
    { path: '/api/agent/automations/proposals', auth: 'Bearer main-user-only' },
    { path: '/api/agent/automations/proposals/12/confirm', auth: 'Bearer main-user-only' },
    { path: '/nb/v1/agents', auth: 'Bearer northbound-only' },
  ])
  expect((await fetch(proxy + '/api/automations/12/run', { method: 'POST' })).status).toBe(404)
  expect(
    (
      await fetch(proxy + '/api/automations/proposals/12/confirm', {
        method: 'POST',
        headers: { Origin: 'https://untrusted.test' },
      })
    ).status,
  ).toBe(403)
  expect(received).toHaveLength(3)
})

it('does not substitute the northbound key when task credentials are missing', async () => {
  const proxy = await serve(
    createApiMiddleware({
      NEXENT_BASE_URL: 'http://127.0.0.1:1',
      NEXENT_API_KEY: 'northbound-only',
    }),
  )
  const response = await fetch(proxy + '/api/automations')
  expect(response.status).toBe(503)
  expect(await response.text()).toContain('NEXENT_USER_TOKEN')
})

it('explicit speed mode forwards tasks without credentials but retains northbound auth', async () => {
  const received: { path?: string; auth?: string }[] = []
  const upstream = await serve((req, res) => {
    received.push({ path: req.url, auth: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    res.end('{"code":0,"data":{"items":[],"total":0}}')
  })
  const proxy = await serve(
    createApiMiddleware({
      NEXENT_MAIN_API_URL: upstream,
      NEXENT_AUTOMATION_AUTH_MODE: 'speed',
      NEXENT_USER_TOKEN: 'stale-user-token',
      NEXENT_BASE_URL: upstream,
      NEXENT_API_KEY: 'northbound-only',
    }),
  )
  expect(await (await fetch(proxy + '/api/config')).json()).toMatchObject({
    automationConfigured: true,
    automationAuthMode: 'speed',
  })
  expect((await fetch(proxy + '/api/automations')).status).toBe(200)
  expect((await fetch(proxy + '/nb/v1/agents')).status).toBe(200)
  expect(received).toEqual([
    { path: '/agent/automations', auth: undefined },
    { path: '/nb/v1/agents', auth: 'Bearer northbound-only' },
  ])
  expect(
    (
      await fetch(proxy + '/api/automations/proposals', {
        method: 'POST',
        headers: { Origin: 'https://untrusted.test' },
      })
    ).status,
  ).toBe(403)
  expect(received).toHaveLength(2)
})

it.each(['jwt', 'invalid'])(
  'does not silently allow unauthenticated tasks for mode %s',
  async (mode) => {
    const proxy = await serve(
      createApiMiddleware({
        NEXENT_MAIN_API_URL: 'http://127.0.0.1:1',
        NEXENT_AUTOMATION_AUTH_MODE: mode,
      }),
    )
    expect(await (await fetch(proxy + '/api/config')).json()).toMatchObject({
      automationConfigured: false,
    })
    expect((await fetch(proxy + '/api/automations')).status).toBe(503)
  },
)

it('discovers task agents with the main user identity, strips private fields and tenant overrides', async () => {
  let received: { url?: string; auth?: string } = {}
  const configApi = await serve((req, res) => {
    received = { url: req.url, auth: req.headers.authorization }
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify([
        {
          agent_id: 5,
          name: 'ops',
          display_name: '运维助手',
          is_available: true,
          api_key: 'private-agent-key',
          tools: ['private-tool'],
        },
        { agent_id: 8, name: 'offline', is_available: false },
        { agent_id: -1, name: 'invalid' },
      ]),
    )
  })
  const proxy = await serve(
    createApiMiddleware({
      NEXENT_MAIN_API_URL: 'http://127.0.0.1:1',
      NEXENT_AGENT_API_URL: configApi + '/api',
      NEXENT_USER_TOKEN: 'main-user',
      NEXENT_API_KEY: 'northbound-user',
    }),
  )
  const response = await fetch(proxy + '/api/automations/agents?tenant_id=another-tenant')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    code: 0,
    data: [
      { id: 5, name: 'ops', displayName: '运维助手', available: true },
      { id: 8, name: 'offline', displayName: 'offline', available: false },
    ],
  })
  expect(received).toEqual({ url: '/api/agent/published_list', auth: 'Bearer main-user' })
  expect((await fetch(proxy + '/api/automations/agents', { method: 'POST' })).status).toBe(404)
})

it('uses the main gateway for agent discovery and reports discovery errors', async () => {
  let status = 200
  const upstream = await serve((req, res) => {
    expect(req.url).toBe('/api/agent/published_list')
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(status === 200 ? '{"unexpected":"sensitive-data"}' : '{"message":"unauthorized"}')
  })
  const proxy = await serve(
    createApiMiddleware({
      NEXENT_MAIN_API_URL: upstream + '/api',
      NEXENT_AUTOMATION_AUTH_MODE: 'speed',
    }),
  )
  const malformed = await fetch(proxy + '/api/automations/agents')
  expect(malformed.status).toBe(502)
  expect(await malformed.text()).not.toContain('sensitive-data')
  status = 401
  expect((await fetch(proxy + '/api/automations/agents')).status).toBe(401)
})
