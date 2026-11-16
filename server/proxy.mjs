import http from 'node:http'
import https from 'node:https'
import { deleteConversation } from './delete-conversation.mjs'

const allowed = [
  ['GET', /^\/nb\/v1\/(health|agents|models|conversations)$/],
  ['GET', /^\/nb\/v1\/conversations\/\d+$/],
  ['GET', /^\/nb\/v1\/chat\/stop\/\d+$/],
  ['POST', /^\/nb\/v1\/chat\/run$/],
  ['POST', /^\/nb\/v1\/generate_title$/],
  ['PUT', /^\/nb\/v1\/conversations\/\d+\/title$/],
]
const automationAllowed = [
  ['GET', /^\/api\/automations$/],
  ['GET', /^\/api\/automations\/agents$/],
  ['POST', /^\/api\/automations\/proposals$/],
  ['POST', /^\/api\/automations\/proposals\/\d+\/confirm$/],
  ['GET', /^\/api\/automations\/\d+$/],
  ['POST', /^\/api\/automations\/\d+\/(pause|resume)$/],
  ['DELETE', /^\/api\/automations\/\d+$/],
]
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function forwardAutomationAgents(response, res) {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of response) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error('Agent response too large')
      chunks.push(chunk)
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const data = payload?.data ?? payload
    const agents = Array.isArray(data) ? data : data?.agents
    if (!Array.isArray(agents)) throw new Error('Invalid agent response')
    const safe = agents
      .filter(
        (agent) =>
          Number.isInteger(agent?.agent_id) &&
          agent.agent_id > 0 &&
          typeof agent.name === 'string' &&
          agent.name.trim(),
      )
      .map((agent) => ({
        id: agent.agent_id,
        name: agent.name,
        displayName:
          typeof agent.display_name === 'string' && agent.display_name.trim()
            ? agent.display_name
            : agent.name,
        available: agent.is_available === true,
      }))
    if (!res.destroyed) json(res, 200, { code: 0, data: safe })
  } catch {
    if (!res.destroyed) json(res, 502, { message: '智能体列表格式无效或响应过大。' })
  }
}

// Model discovery may contain provider credentials; only expose selection metadata.
async function forwardPublicModels(response, res) {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of response) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error('Model response too large')
      chunks.push(chunk)
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const data = payload?.data ?? payload
    const models = Array.isArray(data) ? data : data?.models
    if (!Array.isArray(models)) throw new Error('Invalid model response')
    const safeModels = models.map((model) => {
      const safe = {}
      for (const key of [
        'model_id',
        'id',
        'model_name',
        'name',
        'display_name',
        'model_type',
        'connect_status',
      ]) {
        if (typeof model?.[key] === 'string' || typeof model?.[key] === 'number')
          safe[key] = model[key]
      }
      return safe
    })
    if (!res.destroyed) json(res, 200, { data: safeModels })
  } catch {
    if (!res.destroyed) json(res, 502, { detail: '模型列表格式无效或响应过大。' })
  }
}

export function createApiMiddleware(env) {
  const configured = Boolean(env.NEXENT_BASE_URL && env.NEXENT_API_KEY)
  // Speed deployments deliberately use Nexent's default user; never infer this from a missing JWT.
  const automationAuthMode = env.NEXENT_AUTOMATION_AUTH_MODE || 'jwt'
  const automationConfigured = Boolean(
    env.NEXENT_MAIN_API_URL &&
    (automationAuthMode === 'speed' ||
      (automationAuthMode === 'jwt' && env.NEXENT_USER_TOKEN?.trim())),
  )
  return (req, res, next = () => json(res, 404, { detail: 'Not found' })) => {
    const path = new URL(req.url, 'http://localhost')
    if (path.pathname === '/api/config') {
      return json(res, 200, {
        configured,
        automationConfigured,
        conversationDeleteConfigured: configured && automationConfigured,
        automationAuthMode,
        automationAgentId: /^\d+$/.test(env.NEXENT_AUTOMATION_AGENT_ID || '')
          ? Number(env.NEXENT_AUTOMATION_AGENT_ID)
          : null,
        agentName: env.NEXENT_AGENT_NAME || '',
        service: 'Nexent 2.5.1',
      })
    }
    const automation =
      path.pathname === '/api/automations' || path.pathname.startsWith('/api/automations/')
    const conversationApi = path.pathname.startsWith('/api/conversations/')
    if (!automation && !conversationApi && !path.pathname.startsWith('/nb/')) return next()
    const origin = req.headers.origin
    let sameOrigin = !origin
    try {
      if (origin) sameOrigin = new URL(origin).host === req.headers.host
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin || req.headers['sec-fetch-site'] === 'cross-site') {
      return json(res, 403, { detail: 'Cross-origin requests are not allowed' })
    }
    if (conversationApi) {
      const match = path.pathname.match(/^\/api\/conversations\/([1-9]\d*)$/)
      if (req.method !== 'DELETE' || !match)
        return json(res, 404, { message: 'Endpoint is not exposed by this application' })
      if (!configured || !automationConfigured)
        return json(res, 503, { message: '删除会话需要同时配置北向服务和主 API 登录连接。' })
      void deleteConversation(env, match[1], res)
      return
    }
    if (
      !(automation ? automationAllowed : allowed).some(
        ([method, pattern]) => method === req.method && pattern.test(path.pathname),
      )
    ) {
      return json(res, 404, { detail: 'Endpoint is not exposed by this application' })
    }
    if (automation && !automationConfigured)
      return json(res, 503, {
        message:
          '请配置 NEXENT_MAIN_API_URL 和 NEXENT_USER_TOKEN 后重启服务。已确认后端为免登录开发模式时，可显式设置 NEXENT_AUTOMATION_AUTH_MODE=speed。北向 access_key 不能代替用户登录凭据。',
      })
    if (!automation && !configured)
      return json(res, 503, { detail: '请先在 .env 中配置北向服务地址和 API Key，然后重启服务。' })
    let target
    try {
      const agentList = path.pathname === '/api/automations/agents'
      target = new URL(
        automation
          ? (agentList && env.NEXENT_AGENT_API_URL) || env.NEXENT_MAIN_API_URL
          : env.NEXENT_BASE_URL,
      )
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Unsupported protocol')
      target.pathname = automation
        ? target.pathname.replace(/\/$/, '') +
          (agentList
            ? '/agent/published_list'
            : path.pathname.replace(/^\/api\/automations/, '/agent/automations'))
        : path.pathname
      // Discovery always uses the authenticated user's scope, never browser-supplied tenant filters.
      target.search = agentList ? '' : path.search
    } catch {
      return json(res, 500, {
        detail: automation ? '任务主 API 地址格式无效。' : '北向服务地址格式无效。',
      })
    }
    const headers = {
      accept: req.headers.accept || 'application/json',
    }
    if (!automation) headers.authorization = `Bearer ${env.NEXENT_API_KEY}`
    else if (automationAuthMode === 'jwt')
      headers.authorization = `Bearer ${env.NEXENT_USER_TOKEN.trim().replace(/^Bearer\s+/i, '')}`
    for (const name of ['content-type', 'content-length', 'idempotency-key', 'x-request-id']) {
      if (req.headers[name]) headers[name] = req.headers[name]
    }
    const upstream = (target.protocol === 'https:' ? https : http).request(
      target,
      { method: req.method, headers },
      (response) => {
        if (path.pathname === '/api/automations/agents' && response.statusCode === 200) {
          void forwardAutomationAgents(response, res)
          return
        }
        if (path.pathname === '/nb/v1/models' && response.statusCode === 200) {
          void forwardPublicModels(response, res)
          return
        }
        const forwarded = { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }
        for (const name of ['content-type', 'x-request-id', 'conversation_id', 'retry-after']) {
          if (response.headers[name]) forwarded[name] = response.headers[name]
        }
        res.writeHead(response.statusCode || 502, forwarded)
        res.flushHeaders()
        response.on('error', () => res.destroy())
        response.pipe(res)
      },
    )
    upstream.setTimeout(180_000, () => upstream.destroy(new Error('Upstream timeout')))
    upstream.on('error', () => {
      if (!res.headersSent)
        json(res, 502, {
          detail: automation
            ? '无法连接任务主 API，请检查 NEXENT_MAIN_API_URL 与网络。'
            : '无法连接北向服务，请检查服务地址与网络。',
        })
      else res.destroy()
    })
    res.on('close', () => upstream.destroy())
    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
  }
}
