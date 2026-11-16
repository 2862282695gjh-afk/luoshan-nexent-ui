import { test, expect, type Page } from '@playwright/test'
// Keep regression runs isolated even when the local app has real credentials.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: false, agentName: '' } }),
  )
})
async function liveFixture(page: Page) {
  const calls: { url: string; method: string; body: any }[] = []
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: true, agentName: 'park' } }),
  )
  await page.route('**/nb/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    calls.push({
      url: url.pathname + url.search,
      method: request.method(),
      body: request.headers()['content-type']?.includes('application/json')
        ? request.postDataJSON()
        : request.postData(),
    })
    if (url.pathname.endsWith('/health')) return route.fulfill({ json: { status: 'healthy' } })
    if (url.pathname.endsWith('/agents'))
      return route.fulfill({ json: { data: [{ name: 'park' }] } })
    if (url.pathname.endsWith('/models'))
      return route.fulfill({
        json: {
          data: [
            { model_id: 9, model_name: '园区模型', model_type: 'llm', connect_status: 'available' },
          ],
        },
      })
    if (url.pathname.endsWith('/conversations')) return route.fulfill({ json: { data: [] } })
    if (url.pathname.endsWith('/run'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"type":"conversation_created","content":{"conversation_id":42}}\n\ndata: {"type":"model_output","content":"增量内容"}\n\ndata: {"type":"final_answer","content":"完整最终答案"}\n\ndata: {"type":"agent_finish","content":""}\n\n',
      })
    return route.fulfill({ json: { message: 'success' } })
  })
  return calls
}
test('reference layout, history search, rename and demo isolation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '连接设置' })).toContainText('演示模式')
  await expect(page.getByRole('heading', { name: '一、通用入驻流程（标准四步法）' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '搜索对话', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索历史对话' }).fill('合同')
  await expect(page.locator('.conversation-title')).toHaveCount(1)
  await page.getByRole('button', { name: '重命名 合同模板对比' }).click()
  await page.getByRole('textbox', { name: '对话名称' }).fill('合同条款核对')
  await page.getByRole('button', { name: '保存名称' }).click()
  await expect(page.locator('.conversation-title')).toHaveText('合同条款核对')
  await page.reload()
  await expect(page.getByRole('button', { name: '合同条款核对', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建对话' }).click()
  await expect(page.getByRole('heading', { name: '您好，有什么可以帮您？' })).toBeVisible()
  await page.getByRole('textbox', { name: '向AI提问' }).fill('园区有什么补贴政策？')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible()
})
test('real text API payload, final answer replacement and multi-turn id', async ({ page }) => {
  const calls = await liveFixture(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '连接设置' })).toContainText('已连接')
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await page.getByRole('textbox', { name: '向AI提问' }).fill('分析报告')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.markdown')).toHaveText('完整最终答案')
  await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible()
  await page.getByRole('textbox', { name: '向AI提问' }).fill('继续分析')
  await page.getByRole('textbox', { name: '向AI提问' }).press('Enter')
  await expect(page.locator('.markdown')).toHaveCount(2)
  await expect(page.locator('.markdown').last()).toHaveText('完整最终答案')
  const runs = calls.filter((c) => c.url.endsWith('/run'))
  expect(runs[0]!.body).toMatchObject({
    agent_name: 'park',
    query: '分析报告',
  })
  expect(runs[0]!.body).not.toHaveProperty('conversation_id')
  expect(runs[0]!.body).not.toHaveProperty('attachments')
  expect(runs[1]!.body.conversation_id).toBe(42)
  expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/42/title?title='))).toBe(true)
})
for (const scenario of [
  {
    status: 401,
    body: { message: 'Invalid bearer token' },
    expected: 'API Key 无效或已过期：Invalid bearer token',
  },
  {
    status: 413,
    body: {
      code: '010107',
      message: 'Runtime metadata exceeds the maximum allowed size.',
      details: { reason: 'METADATA_TOO_LARGE' },
    },
    expected: '请求内容过大：Runtime metadata exceeds the maximum allowed size.',
  },
  {
    status: 422,
    body: {
      detail: [
        { loc: ['body', 'agent_name'], msg: 'Field required', input: { secret: 'PRIVATE' } },
      ],
    },
    expected: '请求参数校验失败：agent_name：Field required',
  },
]) {
  test(`${scenario.status} displays backend details and retains the draft`, async ({ page }) => {
    await liveFixture(page)
    await page.route('**/nb/v1/chat/run', (route) =>
      route.fulfill({ status: scenario.status, json: scenario.body }),
    )
    await page.goto('/')
    await expect(page.getByRole('button', { name: '连接设置' })).toContainText('已连接')
    await page.getByRole('textbox', { name: '向AI提问' }).fill('测试错误提示')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.locator('.message-error')).toContainText(scenario.expected)
    await expect(page.locator('.message-error')).not.toContainText('PRIVATE')
    await expect(page.locator('.markdown')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue('测试错误提示')
    await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled()
  })
}
test('keyboard newline, dialog dismissal and responsive sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '打开历史对话' }).click()
  await expect(page.getByRole('button', { name: '新建对话' })).toBeEnabled()
  await page.getByRole('button', { name: '关闭历史对话' }).click()
  await page.getByRole('button', { name: '连接设置' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('textbox', { name: '向AI提问' }).fill('第一行')
  await page.getByRole('textbox', { name: '向AI提问' }).press('Shift+Enter')
  await page.getByRole('textbox', { name: '向AI提问' }).pressSequentially('第二行')
  await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue('第一行\n第二行')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true, animations: 'disabled' })
})

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} stop calls the backend using the server-created id`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const calls = await liveFixture(page)
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      let finishStoppedStream: () => void

      window.fetch = (input, init) => {
        if (input === '/nb/v1/chat/run') {
          let timer: ReturnType<typeof setTimeout>
          const body = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder()
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"conversation_created","content":{"conversation_id":77}}\n\ndata: {"type":"model_output","content":"正在分析"}\n\n',
                ),
              )
              finishStoppedStream = () => {
                clearTimeout(timer)
                controller.close()
              }
              timer = setTimeout(() => controller.close(), 20000)
              init?.signal?.addEventListener('abort', () => {
                clearTimeout(timer)
                controller.error(new DOMException('Aborted', 'AbortError'))
              })
            },
            cancel() {
              clearTimeout(timer)
            },
          })
          return Promise.resolve(
            new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
          )
        }
        if (input === '/nb/v1/chat/stop/77') {
          return original(input, init).then((response) => {
            finishStoppedStream()
            return response
          })
        }
        return original(input, init)
      }
    })
    await page.goto('/')
    await expect(page.locator(mobile ? '.mobile-heading' : '.connection-button')).toContainText(
      '已连接',
    )
    await page.getByRole('textbox', { name: '向AI提问' }).fill('分析园区情况')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.locator('.markdown')).toHaveText('正在分析')
    await page.getByRole('button', { name: '停止生成' }).click()
    await expect(page.getByText('已停止生成', { exact: true })).toBeVisible()
    expect(calls.some((c) => c.method === 'GET' && c.url.endsWith('/chat/stop/77'))).toBe(true)
  })
}

test('mobile welcome, history drawer and expanded draft follow the reference states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我是您的AI智能助手' })).toBeVisible()
  await expect(page.locator('.mobile-heading')).toContainText('演示模式')
  await expect(page.getByRole('dialog', { name: '历史对话' })).not.toBeVisible()
  await page.screenshot({ path: 'test-results/mobile-welcome.png' })
  await page.getByRole('button', { name: '打开历史对话' }).click()
  const history = page.getByRole('dialog', { name: '历史对话' })
  await expect(history).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile-history.png' })
  await page.getByRole('button', { name: '重命名 合同模板对比' }).click()
  await page.getByRole('textbox', { name: '对话名称' }).fill('合同资料核对')
  await page.getByRole('button', { name: '保存名称' }).click()
  await expect(history.getByRole('button', { name: '合同资料核对', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '搜索对话', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索历史对话' }).fill('入驻')
  await page.getByRole('button', { name: '入驻流程问答', exact: true }).click()
  await expect(history).not.toBeVisible()
  await expect(page.locator('.markdown')).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile-conversation.png' })
  await page.getByRole('button', { name: '返回助手首页' }).click()
  await page
    .getByRole('textbox', { name: '向AI提问' })
    .fill('请介绍入驻流程，特别是需要准备的材料。')
  await page.getByRole('button', { name: '展开输入框' }).click()
  const editor = page.getByRole('textbox', { name: '编辑完整问题' })
  await expect(editor).toHaveValue('请介绍入驻流程，特别是需要准备的材料。')
  await editor.fill('请介绍入驻流程。\n申请材料、审批时间分别是什么？')
  await page.screenshot({ path: 'test-results/mobile-editor.png' })
  await page.getByRole('button', { name: '收起输入框' }).click()
  await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue(
    '请介绍入驻流程。\n申请材料、审批时间分别是什么？',
  )
  await page.getByRole('button', { name: '展开输入框' }).click()
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await expect(editor).toHaveValue('')
  await expect(page.getByRole('button', { name: '发送完整问题' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '展开输入', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: '打开历史对话' }).click()
  await page.mouse.click(380, 300)
  await expect(history).not.toBeVisible()
})

test('mobile expanded composer sends real API payload and continues the same conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const calls = await liveFixture(page)
  // Successful deployment streams may close immediately after final_answer.
  await page.route('**/nb/v1/chat/run', async (route) => {
    calls.push({ url: '/nb/v1/chat/run', method: 'POST', body: route.request().postDataJSON() })
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"type":"conversation_created","content":{"conversation_id":42}}\n\ndata: {"type":"model_output","content":"增量文本"}\n\ndata: {"type":"final_answer","content":"完整最终答案"}\n\n',
    })
  })
  await page.goto('/')
  await expect(page.locator('.mobile-heading')).toContainText('已连接')
  await page.getByRole('button', { name: '展开输入框' }).click()
  await page.getByRole('textbox', { name: '编辑完整问题' }).fill('移动端问题\n补充说明')
  await page.getByRole('button', { name: '发送完整问题' }).click()
  await expect(page.getByRole('dialog', { name: '展开输入', exact: true })).not.toBeVisible()
  await expect(page.locator('.markdown')).toHaveText('完整最终答案')
  await page.getByRole('textbox', { name: '向AI提问' }).fill('继续')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown')).toHaveCount(2)
  const runs = calls.filter((c) => c.url.endsWith('/run'))
  expect(runs).toHaveLength(2)
  expect(runs[0]!.body).toMatchObject({ agent_name: 'park', query: '移动端问题\n补充说明' })
  expect(runs[0]!.body).not.toHaveProperty('attachments')
  expect(runs[1]!.body.conversation_id).toBe(42)
  await expect(page.locator('input[type=file]')).toHaveCount(0)
})

test('mobile layout fits narrow and short viewports and restores desktop without losing draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我是您的AI智能助手' })).toBeVisible()
  await page.getByRole('textbox', { name: '向AI提问' }).fill('保留这条草稿')
  for (const size of [
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 390, height: 400 },
  ]) {
    await page.setViewportSize(size)
    const composer = page.locator('.composer')
    await expect(composer).toBeVisible()
    await expect
      .poll(async () => {
        const box = await composer.boundingBox()
        return box!.y + box!.height
      })
      .toBeLessThanOrEqual(size.height)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  await page.getByRole('button', { name: '打开历史对话' }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.getByRole('complementary', { name: '历史对话' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue('保留这条草稿')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} keeps streaming after code errors and sub-agent completion`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const calls = await liveFixture(page)
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      let stream: ReadableStreamDefaultController<Uint8Array>
      const emit = (type: string, content: unknown) =>
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, content })}\n\n`))
      ;(window as any).continueTestStream = () => {
        emit('agent_finish', '子智能体完成')
        emit('model_output_deep_thinking', '工具失败后重新推理。')
        emit('model_output', '恢复后的增量内容')
      }
      ;(window as any).finishTestStream = () => {
        emit('final_answer', '恢复后的完整最终答案')
        stream.close()
      }
      window.fetch = (input, init) => {
        if (input !== '/nb/v1/chat/run') return original(input, init)
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            emit('conversation_created', { conversation_id: 42 })
            emit('model_output_thinking', '初始推理。')
            emit('model_output', '初始内容')
            emit('error', 'Code execution failed: NameError')
            emit('agent_error', { message: '第二次工具调用失败' })
          },
        })
        return Promise.resolve(
          new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
        )
      }
    })
    await page.goto('/')
    await expect(page.locator(mobile ? '.mobile-heading' : '.connection-button')).toContainText(
      '已连接',
    )
    await page.getByRole('textbox', { name: '向AI提问' }).fill('测试工具恢复')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.locator('.stream-warnings summary')).toContainText('2')
    await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
    await expect(page.locator('.message-error')).toHaveCount(0)
    await page.locator('.stream-warnings summary').click()
    await expect(page.locator('.stream-warnings')).toContainText('Code execution failed')
    await page.evaluate(() => (window as any).continueTestStream())
    await expect(page.locator('.markdown')).toHaveText('初始内容恢复后的增量内容')
    await page.locator('.thinking:not(.stream-warnings) summary').click()
    await expect(page.locator('.thinking:not(.stream-warnings) p')).toHaveText(
      '初始推理。工具失败后重新推理。',
    )
    await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
    await page.evaluate(() => (window as any).finishTestStream())
    await expect(page.locator('.markdown')).toHaveText('恢复后的完整最终答案')
    await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible()
    await expect(page.locator('.message-error')).toHaveCount(0)
    expect(calls.filter((c) => c.url === '/nb/v1/conversations')).toHaveLength(1)
  })
}

for (const ending of [
  'error-eof',
  'error-done',
  'error-after-final',
  'concurrent-run',
  'truncated',
] as const) {
  test(`stream ${ending} retains partial text and reports incomplete result`, async ({ page }) => {
    const calls = await liveFixture(page)
    await page.route('**/nb/v1/chat/run', (route) => {
      const events = [
        { type: 'conversation_created', content: { conversation_id: 42 } },
        { type: 'model_output', content: '已收到的部分内容' },
      ]
      if (ending === 'error-after-final')
        events.push({ type: 'final_answer', content: '已收到的部分内容' })
      if (ending !== 'truncated')
        events.push({
          type: 'error',
          content:
            ending === 'concurrent-run'
              ? '当前会话已有智能体任务正在运行'
              : 'Code execution failed',
        })
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
          (ending === 'error-done' ? 'data: [DONE]\n\n' : ''),
      })
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: '连接设置' })).toContainText('已连接')
    await page.getByRole('textbox', { name: '向AI提问' }).fill('失败场景')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.locator('.markdown')).toHaveText('已收到的部分内容')
    await expect(page.locator('.message-error')).toContainText(
      ending === 'truncated'
        ? '连接提前中断'
        : ending === 'concurrent-run'
          ? '上一轮停止尚未在服务端生效'
          : '未收到后续完整结果',
    )
    await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} separates reasoning, tool arguments and results from the answer`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await liveFixture(page)
    await page.route('**/nb/v1/chat/run', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: [
          { type: 'conversation_created', content: { conversation_id: 42 } },
          { type: 'model_output_deep_thinking', content: '先查询设备，再核对结果。' },
          { type: 'model_output_code', content: 'print(device_status)' },
          {
            type: 'tool',
            tool_name: 'device_status',
            tool_arguments: { device: '设备 A' },
            tool_call_id: 'a',
            content: '',
          },
          {
            type: 'tool',
            tool_name: 'maintenance_history',
            tool_arguments: { device: '设备 B' },
            tool_call_id: 'b',
            content: '',
          },
          { type: 'execution_logs', tool_call_id: 'a', content: '设备 A：正常' },
          { type: 'error', tool_call_id: 'b', content: 'Code execution failed' },
          { type: 'model_output_thinking', content: '第二个工具失败，继续整理已有结果。' },
          { type: 'final_answer', content: '设备 A 运行正常，设备 B 暂未取得数据。' },
        ]
          .map((e) => `data: ${JSON.stringify(e)}\n\n`)
          .join(''),
      }),
    )
    await page.goto('/')
    await expect(page.locator(mobile ? '.mobile-heading' : '.connection-button')).toContainText(
      '已连接',
    )
    await page.getByRole('textbox', { name: '向AI提问' }).fill('检查设备')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.locator('.markdown')).toHaveText('设备 A 运行正常，设备 B 暂未取得数据。')
    await expect(page.locator('.markdown')).not.toContainText('print(')
    await expect(page.locator('.message-error')).toHaveCount(0)
    const thinking = page.locator('.message-process > .thinking')
    await thinking.locator(':scope > summary').click()
    await expect(thinking.locator(':scope > p')).toContainText('继续整理已有结果')
    await thinking.locator('.reasoning-code > summary').click()
    await expect(thinking.locator('pre')).toHaveText('print(device_status)')
    await page.locator('.tool-process > summary').click()
    const tools = page.locator('.tool-call')
    await expect(tools).toHaveCount(2)
    await tools.nth(0).locator(':scope > summary').click()
    await tools.nth(1).locator(':scope > summary').click()
    await expect(tools.nth(0).locator('.tool-arguments')).toContainText('设备 A')
    await expect(tools.nth(0).locator('.tool-output')).toHaveText('设备 A：正常')
    await expect(tools.nth(1).locator('.tool-error')).toHaveText('Code execution failed')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: `test-results/process-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
  })
}
