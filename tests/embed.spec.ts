import { expect, test, type Page } from '@playwright/test'

type RequestCall = {
  path: string
  method: string
  body: unknown
}

type StreamEvent = Record<string, unknown>

function sse(events: StreamEvent[]) {
  return [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join(
    '',
  )
}

async function liveFixture(
  page: Page,
  reply = (run: number): StreamEvent[] => [
    { type: 'conversation_created', content: { conversation_id: 42 } },
    { type: 'model_output', content: `第 ${run + 1} 轮增量内容` },
    { type: 'final_answer', content: `第 ${run + 1} 轮完整回答` },
  ],
) {
  const calls: RequestCall[] = []
  let run = 0
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: true, agentName: 'park' } }),
  )
  await page.route('**/nb/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const isJson = request.headers()['content-type']?.includes('application/json')
    calls.push({
      path,
      method: request.method(),
      body: isJson ? request.postDataJSON() : request.postData(),
    })
    if (path.endsWith('/health')) return route.fulfill({ json: { status: 'healthy' } })
    if (path.endsWith('/agents'))
      return route.fulfill({
        json: { data: [{ name: 'park', display_name: '园区运维助手' }] },
      })
    if (path.endsWith('/chat/run')) {
      const events = reply(run++)
      return route.fulfill({ contentType: 'text/event-stream', body: sse(events) })
    }
    return route.fulfill({ json: { message: 'success' } })
  })
  return calls
}

async function expectEmbedConnected(page: Page) {
  await expect(page.locator('.embed-connection')).toContainText('已连接服务')
}

test('嵌入式对话不加载历史，流式工具错误可恢复且沿用本页会话 ID', async ({ page }) => {
  const calls = await liveFixture(page, (run) => {
    if (run === 0)
      return [
        { type: 'conversation_created', content: { conversation_id: 42 } },
        { type: 'model_output_thinking', content: '先分析设备状态。' },
        { type: 'model_output', content: '会被替换的增量内容' },
        {
          type: 'tool',
          tool_name: '设备巡检',
          tool_arguments: { device: 'A-01' },
          tool_call_id: 'inspection-1',
          content: '',
        },
        { type: 'error', tool_call_id: 'inspection-1', content: 'Code execution failed' },
        { type: 'model_output_deep_thinking', content: '工具失败后继续推理。' },
        { type: 'model_output', content: '恢复后的增量内容' },
        { type: 'final_answer', content: '设备 A-01 需要人工复核。' },
      ]
    return [
      { type: 'model_output', content: '第二轮增量内容' },
      { type: 'final_answer', content: '第二轮完整回答。' },
    ]
  })

  await page.goto('/embed/')
  await expectEmbedConnected(page)
  await expect(page.getByRole('complementary', { name: '历史对话' })).toHaveCount(0)
  expect(calls.some((call) => call.path.startsWith('/nb/v1/conversations'))).toBe(false)

  const prompt = page.getByRole('textbox', { name: '向罗山智能助手提问' })
  await prompt.fill('请检查设备 A-01')
  await page.getByRole('button', { name: '发送消息' }).click()

  const answer = page.locator('.markdown').last()
  await expect(answer).toHaveText('设备 A-01 需要人工复核。')
  await expect(answer).not.toContainText('会被替换的增量内容')
  await expect(page.locator('.embed-message-error')).toHaveCount(0)
  await expect(page.locator('.embed-warnings')).toContainText('Code execution failed')
  await page.locator('.message-process > .thinking > summary').click()
  await expect(page.locator('.message-process > .thinking')).toContainText('工具失败后继续推理。')
  await page.locator('.tool-process > summary').click()
  await page.locator('.tool-call > summary').click()
  await expect(page.locator('.tool-error')).toHaveText('Code execution failed')

  await prompt.fill('请继续')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.markdown').last()).toHaveText('第二轮完整回答。')

  const runs = calls.filter((call) => call.path.endsWith('/chat/run'))
  expect(runs).toHaveLength(2)
  expect(runs[0]!.body).toMatchObject({
    agent_name: 'park',
    query: '请检查设备 A-01',
    meta_data: { source: 'luoshan-portal-widget' },
  })
  expect(runs[0]!.body).not.toHaveProperty('conversation_id')
  expect(runs[1]!.body).toMatchObject({ conversation_id: 42, query: '请继续' })
  expect(calls.some((call) => call.path.startsWith('/nb/v1/conversations'))).toBe(false)
})

test('嵌入式小窗在两种紧凑尺寸下不横向溢出', async ({ page }) => {
  await liveFixture(page)
  for (const size of [
    { width: 380, height: 600 },
    { width: 480, height: 720 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('/embed/?chrome=0')
    await expectEmbedConnected(page)
    const composer = page.locator('.embed-composer')
    await expect(composer).toBeVisible()
    const box = await composer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
})

test('嵌入式小窗的 Can Do List 向上纵向展开，选择用例只填入草稿', async ({ page }) => {
  const calls = await liveFixture(page)
  await page.goto('/embed/?chrome=0')
  await expectEmbedConnected(page)

  const canDo = page.getByRole('region', { name: '可用能力' })
  const labels = ['知识问答', '数据分析', '预测预警', '巡检上报', '运维报告']
  for (const label of labels)
    await expect(canDo.getByRole('button', { name: label, exact: true })).toBeVisible()
  await expect(canDo.locator('.can-do-capability')).toHaveCount(5)
  expect(
    await canDo
      .getByRole('button', { name: '知识问答', exact: true })
      .evaluate((button) => getComputedStyle(button).flexDirection),
  ).toBe('column')

  const analysis = canDo.getByRole('button', { name: '数据分析', exact: true })
  await analysis.hover()
  const popover = page.locator('.can-do-popover')
  await expect(popover).toContainText('园区现在的用电负荷怎么样？今天总能耗多少？')
  const [triggerBox, popoverBox] = await Promise.all([
    analysis.boundingBox(),
    popover.boundingBox(),
  ])
  expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(triggerBox!.y + 1)

  const exampleBoxes = await popover
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()))
  expect(exampleBoxes[1]!.y).toBeGreaterThan(exampleBoxes[0]!.y)
  expect(Math.abs(exampleBoxes[1]!.x - exampleBoxes[0]!.x)).toBeLessThanOrEqual(1)

  const prompt = page.getByRole('textbox', { name: '向罗山智能助手提问' })
  await popover.getByRole('button', { name: '园区现在的用电负荷怎么样？今天总能耗多少？' }).click()
  await expect(prompt).toHaveValue('园区现在的用电负荷怎么样？今天总能耗多少？')
  expect(calls.filter((call) => call.path.endsWith('/chat/run'))).toHaveLength(0)

  const report = canDo.getByRole('button', { name: '运维报告', exact: true })
  await report.hover()
  const reportPopover = page.getByRole('region', { name: '运维报告示例问题' })
  await expect(reportPopover).toBeVisible()
  const reportBox = await reportPopover.boundingBox()
  const viewport = page.viewportSize()!
  expect(reportBox!.x).toBeGreaterThanOrEqual(0)
  expect(reportBox!.x + reportBox!.width).toBeLessThanOrEqual(viewport.width + 1)
  await reportPopover.hover()
  await expect(reportPopover).toBeVisible()
  await page.screenshot({
    path: 'test-results/embed-can-do.png',
    fullPage: true,
    animations: 'disabled',
  })
  await reportPopover.getByRole('button', { name: '给我一份上周的运维周报' }).click()
  await expect(prompt).toHaveValue('给我一份上周的运维周报')
  expect(calls.filter((call) => call.path.endsWith('/chat/run'))).toHaveLength(0)
})

test('380px 嵌入式小窗可选择 Can Do 用例，发送后能力栏仍保留', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 600 })
  const calls = await liveFixture(page)
  await page.goto('/embed/?chrome=0')
  await expectEmbedConnected(page)

  const canDo = page.getByRole('region', { name: '可用能力' })
  await expect(canDo.locator('.can-do-capability')).toHaveCount(5)
  await canDo.getByRole('button', { name: '运维报告', exact: true }).click()
  const popover = page.locator('.can-do-popover')
  await expect(popover).toContainText('生成今天的运维日报')
  const popoverBox = await popover.boundingBox()
  expect(popoverBox!.x).toBeGreaterThanOrEqual(0)
  expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(381)

  const prompt = page.getByRole('textbox', { name: '向罗山智能助手提问' })
  await popover.getByRole('button', { name: '生成今天的运维日报' }).click()
  await expect(prompt).toHaveValue('生成今天的运维日报')
  expect(calls.filter((call) => call.path.endsWith('/chat/run'))).toHaveLength(0)

  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.markdown').last()).toHaveText('第 1 轮完整回答')
  await expect(canDo).toBeVisible()
  await expect(canDo.locator('.can-do-capability')).toHaveCount(5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('门户悬浮球打开真实对话 iframe，关闭后继续保留当前会话', async ({ page }) => {
  const calls = await liveFixture(page)
  await page.goto('/portal-demo/')

  const open = page.getByRole('button', { name: '打开 AI 智能助手' })
  await expect(open).toBeVisible()
  await open.click()

  const iframe = page.locator('iframe[title="罗山智能助手对话"]')
  await expect(iframe).toBeVisible()
  const chat = page.frameLocator('iframe[title="罗山智能助手对话"]')
  await expect(chat.locator('.embed-connection')).toContainText('已连接服务')
  const canDo = chat.getByRole('region', { name: '可用能力' })
  for (const label of ['知识问答', '数据分析', '预测预警', '巡检上报', '运维报告'])
    await expect(canDo.getByRole('button', { name: label, exact: true })).toBeVisible()

  const prompt = chat.getByRole('textbox', { name: '向罗山智能助手提问' })
  await prompt.fill('第一轮门户提问')
  await chat.getByRole('button', { name: '发送消息' }).click()
  await expect(chat.locator('.markdown').last()).toHaveText('第 1 轮完整回答')

  await page.getByRole('button', { name: '关闭 AI 智能助手' }).click()
  await expect(iframe).toBeHidden()
  await expect(open).toBeVisible()
  await open.click()
  await expect(iframe).toBeVisible()
  await expect(chat.locator('.markdown').last()).toHaveText('第 1 轮完整回答')

  await prompt.fill('第二轮门户提问')
  await chat.getByRole('button', { name: '发送消息' }).click()
  await expect(chat.locator('.markdown').last()).toHaveText('第 2 轮完整回答')

  const runs = calls.filter((call) => call.path.endsWith('/chat/run'))
  expect(runs).toHaveLength(2)
  expect(runs[1]!.body).toMatchObject({ conversation_id: 42, query: '第二轮门户提问' })
  expect(calls.some((call) => call.path.startsWith('/nb/v1/conversations'))).toBe(false)
})

test('嵌入式对话停止后可立即继续，旧流结束不会覆盖新一轮状态', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: true, agentName: 'park' } }),
  )
  await page.route('**/nb/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/health')) return route.fulfill({ json: { status: 'healthy' } })
    if (path.endsWith('/agents')) return route.fulfill({ json: { data: [{ name: 'park' }] } })
    return route.fulfill({ json: { message: 'success' } })
  })
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    const state: any = { runs: [], stops: 0, aborts: [] }
    ;(window as any).embedStopResume = state
    window.fetch = (input, init) => {
      if (input === '/nb/v1/chat/run') {
        const runIndex = state.runs.length
        state.runs.push(JSON.parse(init!.body as string))
        let controller: ReadableStreamDefaultController<Uint8Array>
        const emit = (type: string, content: unknown) =>
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ type, content })}\n\n`),
          )
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController
            emit('conversation_created', { conversation_id: 77 })
            emit('model_output', runIndex === 0 ? '第一轮生成中' : '第二轮生成中')
            init?.signal?.addEventListener('abort', () => {
              state.aborts.push(runIndex)
              if (runIndex === 0) {
                state.releaseFirst = () => {
                  try {
                    streamController.error(new DOMException('Aborted', 'AbortError'))
                  } catch {}
                }
              } else {
                try {
                  streamController.error(new DOMException('Aborted', 'AbortError'))
                } catch {}
              }
            })
          },
        })
        if (runIndex === 1)
          state.finishSecond = () => {
            emit('final_answer', '第二轮完整回答')
            controller.close()
          }
        return Promise.resolve(
          new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
        )
      }
      if (input === '/nb/v1/chat/stop/77') {
        state.stops++
        return new Promise<Response>((resolve) => {
          state.resolveStop = () =>
            resolve(
              new Response('{"message":"success"}', {
                headers: { 'Content-Type': 'application/json' },
              }),
            )
        })
      }
      return originalFetch(input, init)
    }
  })

  await page.goto('/embed/')
  await expectEmbedConnected(page)
  const prompt = page.getByRole('textbox', { name: '向罗山智能助手提问' })
  await prompt.fill('第一轮')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.markdown').last()).toHaveText('第一轮生成中')

  await page.getByRole('button', { name: '停止生成' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).embedStopResume.aborts)).toEqual([0])
  await expect.poll(() => page.evaluate(() => (window as any).embedStopResume.stops)).toBe(1)

  await prompt.fill('继续提问')
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled()
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.markdown').last()).toHaveText('第二轮生成中')
  expect(await page.evaluate(() => (window as any).embedStopResume.runs[1].conversation_id)).toBe(
    77,
  )

  await page.evaluate(() => (window as any).embedStopResume.releaseFirst())
  await expect(page.locator('.embed-generating')).toContainText('正在生成')
  await expect(page.locator('.embed-message-error')).toHaveCount(0)

  await page.evaluate(() => (window as any).embedStopResume.resolveStop())
  await page.evaluate(() => (window as any).embedStopResume.finishSecond())
  await expect(page.locator('.markdown').last()).toHaveText('第二轮完整回答')
  await expect(page.locator('.embed-message-error')).toHaveCount(0)
})
