import { test, expect, type Page } from '@playwright/test'
async function live(page: Page, fail = false) {
  let deleted = false
  const calls: string[] = []
  await page.route('**/api/config', (r) =>
    r.fulfill({
      json: { configured: true, agentName: 'park', conversationDeleteConfigured: true },
    }),
  )
  await page.route('**/nb/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname
    if (p.endsWith('/health')) return r.fulfill({ json: { status: 'healthy' } })
    if (p.endsWith('/agents')) return r.fulfill({ json: { data: [{ name: 'park' }] } })
    if (p.endsWith('/models')) return r.fulfill({ json: { data: [] } })
    if (p.endsWith('/conversations'))
      return r.fulfill({
        json: {
          data: [
            { conversation_id: 41, conversation_title: '保留的对话', update_time: 1 },
            ...(deleted
              ? []
              : [{ conversation_id: 42, conversation_title: '待删除的对话', update_time: 2 }]),
          ],
        },
      })
    return r.fulfill({
      json: {
        data: {
          history: [
            { role: 'assistant', content: p.endsWith('/42') ? '待删除的正文' : '保留的正文' },
          ],
        },
      },
    })
  })
  await page.route('**/api/conversations/*', async (r) => {
    calls.push(r.request().method() + ' ' + new URL(r.request().url()).pathname)
    if (fail) return r.fulfill({ status: 502, json: { message: '删除结果未确认' } })
    deleted = true
    return r.fulfill({ json: { code: 0, data: true } })
  })
  return calls
}
for (const mobile of [false, true])
  test(`${mobile ? 'mobile' : 'desktop'} confirms deletion, clears the selected chat and survives reload`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const calls = await live(page)
    await page.goto('/')
    await expect(page.locator(mobile ? '.mobile-heading' : '.connection-button')).toContainText(
      '已连接',
    )
    if (mobile) {
      await page.getByRole('button', { name: '打开历史对话' }).click()
      await page.getByRole('button', { name: '待删除的对话', exact: true }).click()
      await page.getByRole('button', { name: '打开历史对话' }).click()
    }
    await page.getByRole('button', { name: '删除 待删除的对话', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '删除对话', exact: true })
    await expect(modal).toContainText('关联任务也会被删除')
    await expect(modal.getByRole('button', { name: '取消', exact: true })).toBeFocused()
    expect(calls).toHaveLength(0)
    await modal.getByRole('button', { name: '取消', exact: true }).click()
    expect(calls).toHaveLength(0)
    await page.getByRole('button', { name: '删除 待删除的对话', exact: true }).click()
    await page.screenshot({ path: `test-results/delete-${mobile ? 'mobile' : 'desktop'}.png` })
    await modal.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(modal).not.toBeVisible()
    await expect(page.getByRole('button', { name: '待删除的对话', exact: true })).toHaveCount(0)
    await expect(page.locator('.markdown')).toHaveCount(0)
    expect(calls).toEqual(['DELETE /api/conversations/42'])
    await page.reload()
    if (mobile) await page.getByRole('button', { name: '打开历史对话' }).click()
    await expect(page.getByRole('button', { name: '保留的对话', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '待删除的对话', exact: true })).toHaveCount(0)
  })
test('failed deletion retains messages and blocks repeated confirmation', async ({ page }) => {
  const calls = await live(page, true)
  await page.goto('/')
  await expect(page.locator('.markdown')).toHaveText('待删除的正文')
  await page.getByRole('button', { name: '删除 待删除的对话', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '删除对话', exact: true })
  await modal.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('删除结果未确认')
  await expect(modal.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled()
  expect(calls).toHaveLength(1)
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.markdown')).toHaveText('待删除的正文')
  await expect(page.getByRole('button', { name: '待删除的对话', exact: true })).toBeVisible()
})
test('deleting another conversation preserves the active answer and draft', async ({ page }) => {
  const calls = await live(page)
  await page.goto('/')
  await expect(page.locator('.markdown')).toHaveText('待删除的正文')
  await page.getByRole('textbox', { name: '向AI提问' }).fill('尚未发送的草稿')
  await page.getByRole('button', { name: '删除 保留的对话', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.markdown')).toHaveText('待删除的正文')
  await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue('尚未发送的草稿')
  expect(calls).toEqual(['DELETE /api/conversations/41'])
})
for (const storageFails of [false, true])
  test(`demo deletion persists an empty list or reports storage failure=${storageFails}`, async ({
    page,
  }) => {
    const calls: string[] = []
    await page.route('**/api/config', (r) => r.fulfill({ json: { configured: false } }))
    await page.route('**/api/conversations/*', (r) => {
      calls.push(r.request().method())
      return r.fulfill({ json: {} })
    })
    await page.addInitScript(
      ({ storageFails }) => {
        if (!localStorage.getItem('delete-seeded')) {
          localStorage.setItem(
            'luoshan-demo-v1',
            JSON.stringify([{ id: -1, title: '唯一演示对话', time: 1, messages: [] }]),
          )
          localStorage.setItem('delete-seeded', 'true')
        }
        if (storageFails) {
          const original = Storage.prototype.setItem
          Storage.prototype.setItem = function (k, v) {
            if (k === 'luoshan-demo-v1') throw new Error('Storage unavailable')
            original.call(this, k, v)
          }
        }
      },
      { storageFails },
    )
    await page.goto('/')
    await page.getByRole('button', { name: '删除 唯一演示对话', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    if (storageFails) {
      await expect(page.getByRole('alert')).toContainText('Storage unavailable')
      await expect(page.getByRole('button', { name: '唯一演示对话', exact: true })).toHaveCount(1)
    } else {
      await expect(page.getByText('暂无历史对话', { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText('暂无历史对话', { exact: true })).toBeVisible()
    }
    expect(calls).toHaveLength(0)
  })
