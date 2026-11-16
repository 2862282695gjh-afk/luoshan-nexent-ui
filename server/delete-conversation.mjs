function endpoint(base, path, preservePrefix = true) {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid API URL')
  url.pathname = (preservePrefix ? url.pathname.replace(/\/$/, '') : '') + path
  url.search = ''
  return url
}

async function readJson(response) {
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 4 * 1024 * 1024) throw new Error('Response too large')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// The main delete API does not enforce ownership in all Nexent versions.
// Require membership in both identities' server-side lists before forwarding a deletion.
export async function deleteConversation(env, id, res) {
  const reply = (status, body) => {
    if (res.destroyed) return
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  let sentDelete = false
  try {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1)
      return reply(400, { message: '无效的会话编号。' })
    const mainHeaders =
      (env.NEXENT_AUTOMATION_AUTH_MODE || 'jwt') === 'speed'
        ? {}
        : { authorization: `Bearer ${env.NEXENT_USER_TOKEN.trim().replace(/^Bearer\s+/i, '')}` }
    const fetchList = async (url, headers, main) => {
      const response = await fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('Cannot verify conversation ownership')
      const body = await readJson(response)
      if (main && body.code !== 0) throw new Error('Cannot verify main API identity')
      const data = body.data ?? body
      const list = Array.isArray(data) ? data : (data?.items ?? data?.conversations)
      if (!Array.isArray(list)) throw new Error('Invalid conversation list')
      return list.some((item) => String(item.conversation_id) === id)
    }
    const mainListUrl = endpoint(env.NEXENT_MAIN_API_URL, '/conversation/list')
    // Newer runtime versions require grouping boundaries; omit limit to request all owned rows.
    mainListUrl.searchParams.set('today_start_ms', '0')
    mainListUrl.searchParams.set('week_start_ms', '0')
    const [northboundOwns, mainOwns] = await Promise.all([
      fetchList(
        endpoint(env.NEXENT_BASE_URL, '/nb/v1/conversations', false),
        { authorization: `Bearer ${env.NEXENT_API_KEY}` },
        false,
      ),
      fetchList(mainListUrl, mainHeaders, true),
    ])
    if (!northboundOwns || !mainOwns)
      return reply(403, {
        message:
          '该会话不在当前北向与主 API 用户共同可见的列表中，可能已删除或登录身份不一致。请刷新列表并核对连接配置。',
      })
    if (res.destroyed) return
    sentDelete = true
    const response = await fetch(endpoint(env.NEXENT_MAIN_API_URL, `/conversation/${id}`), {
      method: 'DELETE',
      headers: mainHeaders,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    const body = await readJson(response)
    if (!response.ok || body.code !== 0 || body.data !== true)
      return reply(502, {
        message: '后端未确认删除成功，请刷新历史核实；相关定时任务可能已受影响，请勿重复提交。',
      })
    reply(200, { code: 0, message: 'success', data: true })
  } catch {
    reply(502, {
      message: sentDelete
        ? '删除结果未确认，请刷新历史及定时任务核实，请勿重复提交。'
        : '无法核实会话归属，未发送删除请求。请检查主 API 与北向服务连接及登录凭据。',
    })
  }
}
