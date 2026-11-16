import { test, expect, type Page } from '@playwright/test'
const trigger = {
  mode: 'RECURRING',
  rule_type: 'CRON',
  timezone: 'Asia/Shanghai',
  start_at: '2099-01-01T00:00:00+08:00',
  cron_expr: '0 8 * * *',
}
const proposed = {
  proposal_id: 12,
  conversation_id: 37,
  executable: true,
  task: {
    title: '设备巡检日报',
    instruction: '检查园区设备并汇总异常。',
    agent_id: 7,
    agent_name: '运维助手',
    schedule_trigger: trigger,
  },
  capability_resolution: { executable: true, missing_capabilities: [] },
}
async function setup(
  page: Page,
  options: { blocked?: boolean; failConfirm?: boolean; mobile?: boolean } = {},
) {
  if (options.mobile) await page.setViewportSize({ width: 390, height: 844 })
  const mutations: { path: string; body: unknown }[] = []
  let active = false
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { configured: false, agentName: '', automationConfigured: true, automationAgentId: 7 },
    }),
  )
  await page.route('**/api/automations**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST')
      mutations.push({ path, body: route.request().postDataJSON() })
    if (path.endsWith('/agents'))
      return route.fulfill({
        json: {
          code: 0,
          data: [
            { id: 7, name: 'ops', displayName: '运维助手', available: true },
            { id: 9, name: 'inspection', displayName: '巡检助手', available: true },
            { id: 10, name: 'offline', displayName: '离线助手', available: false },
          ],
        },
      })
    if (path.endsWith('/proposals'))
      return route.fulfill({
        json: { code: 0, data: { ...proposed, executable: !options.blocked } },
      })
    if (path.endsWith('/confirm')) {
      if (options.failConfirm) return route.fulfill({ status: 504, json: { message: 'Timeout' } })
      active = true
      return route.fulfill({
        json: { code: 0, data: { task_id: 99, title: proposed.task.title, status: 'ACTIVE' } },
      })
    }
    return route.fulfill({
      json: {
        code: 0,
        data: {
          items: active
            ? [
                {
                  task_id: 99,
                  title: proposed.task.title,
                  instruction: proposed.task.instruction,
                  status: 'ACTIVE',
                  schedule_config: trigger,
                  next_fire_at: '2099-01-01T00:00:00Z',
                },
              ]
            : [],
          total: active ? 1 : 0,
        },
      },
    })
  })
  await page.goto('/')
  if (options.mobile) await page.getByRole('button', { name: '打开历史对话' }).click()
  await page.getByRole('button', { name: '定时任务', exact: true }).first().click()
  await page.getByRole('button', { name: '创建定时任务', exact: true }).click()
  await page.getByLabel('任务名称', { exact: true }).fill('我的设备巡检')
  await page.getByLabel('任务内容', { exact: true }).fill('检查设备并汇总异常')
  await page.getByLabel('执行时间', { exact: true }).fill('08:00')
  await expect(page.getByRole('combobox', { name: '执行智能体', exact: true })).toHaveValue('7')
  await expect(page.getByRole('option', { name: '离线助手（暂不可用）' })).toBeDisabled()
  await page
    .getByRole('combobox', { name: '执行智能体', exact: true })
    .selectOption({ label: '巡检助手' })
  await page.getByRole('button', { name: '生成待确认提案' }).click()
  await expect(page.locator('.proposal-card')).toContainText('设备巡检日报')
  return mutations
}
for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} server task remains a proposal until the user confirms`, async ({
    page,
  }) => {
    const calls = await setup(page, { mobile })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toMatchObject({ agent_id: 9, timezone: 'Asia/Shanghai' })
    expect(calls[0]!.body).not.toHaveProperty('conversation_id')
    await expect(page.locator('.proposal-card')).toContainText('每天 08:00')
    await expect(page.locator('.live-task')).toHaveCount(0)
    await page.screenshot({
      path: `test-results/tasks-proposal-${mobile ? 'mobile' : 'desktop'}.png`,
    })
    await page.getByRole('button', { name: '确认并启用任务' }).click()
    await expect(page.locator('.live-task')).toContainText('已启用')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ path: '/api/automations/proposals/12/confirm', body: {} })
    await expect(page.locator('.proposal-card')).toHaveCount(0)
  })
}
test('a non-executable proposal cannot be confirmed', async ({ page }) => {
  const calls = await setup(page, { blocked: true })
  await expect(page.getByRole('button', { name: '确认并启用任务' })).toBeDisabled()
  await expect(page.locator('.proposal-card')).toContainText('能力不足')
  expect(calls).toHaveLength(1)
})
test('uncertain confirmation is not retried or reported as success', async ({ page }) => {
  const calls = await setup(page, { failConfirm: true })
  await page.getByRole('button', { name: '确认并启用任务' }).click()
  await expect(page.getByRole('alert')).toContainText('已禁止重复确认')
  await expect(page.getByRole('button', { name: '确认并启用任务' })).toBeDisabled()
  await page.getByRole('button', { name: '刷新任务列表' }).click()
  expect(calls).toHaveLength(2)
  await expect(page.locator('.live-task')).toHaveCount(0)
})

for (const failure of ['empty', 'unavailable', 'error']) {
  test(`agent discovery ${failure} blocks submission and supports reload by name`, async ({
    page,
  }) => {
    let recovered = false
    let mutations = 0
    await page.route('**/api/config', (route) =>
      route.fulfill({
        json: { configured: false, automationConfigured: true, automationAgentId: 99 },
      }),
    )
    await page.route('**/api/automations**', (route) => {
      if (route.request().method() === 'POST') mutations++
      if (new URL(route.request().url()).pathname.endsWith('/agents')) {
        if (!recovered && failure === 'error')
          return route.fulfill({ status: 502, json: { message: 'Discovery failed' } })
        return route.fulfill({
          json: {
            code: 0,
            data: recovered
              ? [{ id: 9, name: 'inspection', displayName: '巡检助手', available: true }]
              : failure === 'unavailable'
                ? [{ id: 9, name: 'inspection', displayName: '巡检助手', available: false }]
                : [],
          },
        })
      }
      return route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '定时任务', exact: true }).first().click()
    await page.getByRole('button', { name: '创建定时任务', exact: true }).click()
    await page.getByLabel('任务名称', { exact: true }).fill('测试巡检')
    await page.getByLabel('任务内容', { exact: true }).fill('汇总巡检记录')
    await expect(page.getByRole('button', { name: '生成待确认提案' })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: '执行智能体', exact: true })).toBeDisabled()
    await expect(
      page.getByText(failure === 'error' ? '智能体列表加载失败：' : '暂无可用智能体', {
        exact: false,
      }),
    ).toBeVisible()
    recovered = true
    await page.getByRole('button', { name: '重新加载智能体' }).click()
    const select = page.getByRole('combobox', { name: '执行智能体', exact: true })
    await expect(select).toBeEnabled()
    await expect(page.getByRole('button', { name: '生成待确认提案' })).toBeDisabled()
    await select.selectOption({ label: '巡检助手' })
    await expect(page.getByRole('button', { name: '生成待确认提案' })).toBeEnabled()
    expect(mutations).toBe(0)
  })
}
