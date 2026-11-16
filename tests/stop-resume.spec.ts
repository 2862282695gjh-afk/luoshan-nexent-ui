import { expect, test } from '@playwright/test'

for (const scenario of ['known-id', 'before-id', 'stop-failed'] as const)
  for (const mobile of [false, true])
    test(`${mobile ? 'mobile' : 'desktop'} ${scenario}: stops locally and keeps a later run isolated`, async ({
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 })
      await page.route('**/api/config', (route) =>
        route.fulfill({ json: { configured: true, agentName: 'park' } }),
      )
      await page.route('**/nb/v1/**', (route) => {
        const path = new URL(route.request().url()).pathname
        return route.fulfill({
          json: path.endsWith('/agents')
            ? { data: [{ name: 'park' }] }
            : path.endsWith('/conversations') || path.endsWith('/models')
              ? { data: [] }
              : { message: 'success' },
        })
      })
      await page.addInitScript((scenario) => {
        const original = window.fetch.bind(window)
        const state: any = { runs: [], stops: 0, aborts: [] }
        ;(window as any).stopResumeTest = state
        window.fetch = (input, init) => {
          if (input === '/nb/v1/chat/run') {
            const runIndex = state.runs.length
            state.runs.push(JSON.parse(init!.body as string))
            let stream: ReadableStreamDefaultController<Uint8Array>
            const emit = (type: string, content: unknown) =>
              stream.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ type, content })}\n\n`),
              )
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller
                if (runIndex > 0 || scenario !== 'before-id') {
                  const id = runIndex === 0 ? 77 : scenario === 'before-id' ? 78 : 77
                  emit('conversation_created', { conversation_id: id })
                  emit('model_output', runIndex === 0 ? '第一轮生成中' : '第二轮生成中')
                }
                init?.signal?.addEventListener('abort', () => {
                  state.aborts.push(runIndex)
                  if (runIndex === 0) {
                    // Keep the old reader pending until the second run starts. Its late
                    // finally block must not clear the second run's streaming state.
                    state.releaseFirst = () => {
                      try {
                        controller.error(new DOMException('Aborted', 'AbortError'))
                      } catch {}
                    }
                  } else {
                    try {
                      controller.error(new DOMException('Aborted', 'AbortError'))
                    } catch {}
                  }
                })
              },
            })
            if (runIndex === 1)
              state.finishSecond = () => {
                emit('final_answer', '第二轮完整回答')
                stream.close()
              }
            return Promise.resolve(
              new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
            )
          }
          if (input === '/nb/v1/chat/stop/77') {
            state.stops++
            return new Promise<Response>((resolve) => {
              state.resolveStop = (fail = false) =>
                resolve(
                  new Response(fail ? '{"message":"stop unavailable"}' : '{"message":"success"}', {
                    status: fail ? 503 : 200,
                    headers: { 'Content-Type': 'application/json' },
                  }),
                )
            })
          }
          return original(input, init)
        }
      }, scenario)

      await page.goto('/')
      await expect(page.locator(mobile ? '.mobile-heading' : '.connection-button')).toContainText(
        '已连接',
      )
      await page.getByRole('textbox', { name: '向AI提问' }).fill('第一轮')
      await page.getByRole('button', { name: '发送消息' }).click()
      if (scenario !== 'before-id')
        await expect(page.locator('.markdown')).toHaveText('第一轮生成中')

      await page.getByRole('button', { name: '停止生成' }).click()
      await expect
        .poll(() => page.evaluate(() => (window as any).stopResumeTest.aborts))
        .toEqual([0])
      if (scenario === 'before-id') {
        expect(await page.evaluate(() => (window as any).stopResumeTest.stops)).toBe(0)
        await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
        await expect(page.locator('.toast')).toContainText('尚未取得会话 ID')
      } else {
        await expect(page.getByText('已停止生成', { exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => (window as any).stopResumeTest.stops)).toBe(1)
      }

      // The HTTP stop request is deliberately still pending. Like Nexent's own
      // chat page, this UI can begin a new turn without waiting for the old SSE EOF.
      const prompt = page.getByRole('textbox', { name: '向AI提问' })
      await prompt.fill('继续提问')
      await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled()
      await page.getByRole('button', { name: '发送消息' }).click()
      await expect(page.locator('.markdown').last()).toHaveText('第二轮生成中')

      const stateAfterResume = await page.evaluate(() => (window as any).stopResumeTest)
      expect(stateAfterResume.runs).toHaveLength(2)
      if (scenario === 'before-id') expect(stateAfterResume.runs[1].conversation_id).toBeUndefined()
      else expect(stateAfterResume.runs[1].conversation_id).toBe(77)

      // Release the old stream only after the second has started. A stale run is
      // allowed to finish, but it must not mark the second reply stopped or idle.
      await page.evaluate(() => (window as any).stopResumeTest.releaseFirst())
      await expect(page.locator('.generating')).toContainText('正在生成')
      await expect(page.locator('.message-error')).toHaveCount(0)

      if (scenario !== 'before-id')
        await page.evaluate(
          (failed) => (window as any).stopResumeTest.resolveStop(failed),
          scenario === 'stop-failed',
        )
      if (scenario === 'stop-failed')
        await expect(page.locator('.toast')).toContainText('停止请求未获服务端确认')

      await page.evaluate(() => (window as any).stopResumeTest.finishSecond())
      await expect(page.locator('.markdown').last()).toHaveText('第二轮完整回答')
      await expect(page.locator('.message-error')).toHaveCount(0)
    })
