import { test, expect } from '@playwright/test'
for (const mobile of [false, true])
  for (const frequency of ['monthly', 'quarterly', 'yearly']) {
    test(`${mobile ? 'mobile' : 'desktop'} creates ${frequency} proposal with correct date and no auto-confirm`, async ({
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 })
      const requests: any[] = []
      const months = frequency === 'monthly' ? '*' : frequency === 'quarterly' ? '1,4,7,10' : '12'
      await page.route('**/api/config', (r) =>
        r.fulfill({
          json: { configured: false, automationConfigured: true, automationAgentId: 5 },
        }),
      )
      await page.route('**/api/automations**', (r) => {
        const path = new URL(r.request().url()).pathname
        if (path.endsWith('/agents'))
          return r.fulfill({
            json: {
              code: 0,
              data: [{ id: 5, name: 'ops', displayName: '运维助手', available: true }],
            },
          })
        if (r.request().method() === 'POST') {
          requests.push({ path, body: r.request().postDataJSON() })
          return r.fulfill({
            json: {
              code: 0,
              data: {
                proposal_id: 42,
                executable: true,
                task: {
                  title: '周期测试',
                  agent_id: 5,
                  schedule_trigger: {
                    mode: 'RECURRING',
                    rule_type: 'CRON',
                    timezone: 'Asia/Shanghai',
                    start_at: '2099-01-01',
                    cron_expr: `30 8 15 ${months} *`,
                  },
                },
              },
            },
          })
        }
        return r.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
      })
      await page.goto('/')
      if (mobile) await page.getByRole('button', { name: '打开历史对话' }).click()
      await page.getByRole('button', { name: '定时任务', exact: true }).first().click()
      await page.getByRole('button', { name: '创建定时任务', exact: true }).click()
      await page.getByLabel('任务名称', { exact: true }).fill('周期测试')
      await page.getByLabel('任务内容', { exact: true }).fill('汇总设备异常')
      await page.getByLabel('执行频率', { exact: true }).selectOption(frequency)
      await page.getByLabel('每月几日').selectOption('15')
      if (frequency === 'yearly') await page.getByLabel('执行月份').selectOption('12')
      await page.getByLabel('执行时间', { exact: true }).fill('08:30')
      expect(
        await page.locator('.tasks-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      await page.getByRole('button', { name: '生成待确认提案' }).click()
      const label =
        frequency === 'monthly'
          ? '每月15日'
          : frequency === 'quarterly'
            ? '每季度15日（1、4、7、10月）'
            : '每年12月15日'
      await expect(page.locator('.proposal-card')).toContainText(label + ' 08:30')
      await expect(page.getByRole('button', { name: '确认并启用任务' })).toBeEnabled()
      expect(requests).toHaveLength(1)
      expect(requests[0].body.message).toContain(label + ' 08:30')
    })
  }

test('demo yearly month and day survive reload and edit', async ({ page }) => {
  await page.route('**/api/config', (r) => r.fulfill({ json: { configured: false } }))
  await page.goto('/')
  const open = async () => {
    await page.getByRole('button', { name: '定时任务', exact: true }).first().click()
    await page.getByRole('button', { name: '本地演示', exact: true }).click()
  }
  await open()
  await page.getByRole('button', { name: '创建定时任务', exact: true }).click()
  await page.getByLabel('任务名称', { exact: true }).fill('年度测试')
  await page.getByLabel('任务内容', { exact: true }).fill('总结运行情况')
  await page.getByRole('radio', { name: '每年', exact: true }).check()
  await page.getByLabel('执行月份').selectOption('12')
  await page.getByLabel('每月几日').selectOption('31')
  await page.getByRole('button', { name: '生成演示提案' }).click()
  await page.getByRole('button', { name: '确认演示提案' }).click()
  await page.reload()
  await open()
  await expect(page.locator('.task-card')).toContainText('每年12月31日')
  await page.getByRole('button', { name: '编辑 年度测试', exact: true }).click()
  await expect(page.getByLabel('执行月份')).toHaveValue('12')
  await expect(page.getByLabel('每月几日')).toHaveValue('31')
})

test('mismatched backend calendar proposal cannot be enabled', async ({ page }) => {
  await page.route('**/api/config', (r) =>
    r.fulfill({ json: { configured: false, automationConfigured: true, automationAgentId: 5 } }),
  )
  await page.route('**/api/automations**', (r) => {
    const path = new URL(r.request().url()).pathname
    const data = path.endsWith('/agents')
      ? [{ id: 5, name: 'ops', displayName: '运维助手', available: true }]
      : path.endsWith('/proposals')
        ? {
            proposal_id: 42,
            executable: true,
            task: {
              title: '错误周期',
              schedule_trigger: {
                mode: 'RECURRING',
                rule_type: 'CRON',
                timezone: 'Asia/Shanghai',
                start_at: '2099-01-01',
                cron_expr: '0 9 * * *',
              },
            },
          }
        : { items: [], total: 0 }
    return r.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '定时任务', exact: true }).first().click()
  await page.getByRole('button', { name: '创建定时任务', exact: true }).click()
  await page.getByLabel('任务名称', { exact: true }).fill('月报')
  await page.getByLabel('任务内容', { exact: true }).fill('总结设备')
  await page.getByLabel('执行频率', { exact: true }).selectOption('monthly')
  await page.getByRole('button', { name: '生成待确认提案' }).click()
  await expect(page.getByRole('alert')).toContainText('执行计划与所选日期、频率或时间不一致')
  await expect(page.getByRole('button', { name: '确认并启用任务' })).toBeDisabled()
})
