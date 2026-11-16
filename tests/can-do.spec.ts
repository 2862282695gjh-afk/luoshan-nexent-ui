import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: false, agentName: '' } }),
  )
})

test('Can Do list replaces generic quick questions and expands test-case examples upward', async ({
  page,
}) => {
  await page.goto('/')

  const canDoList = page.getByRole('region', { name: '可用能力' })
  await expect(canDoList).toBeVisible()
  await expect(canDoList.getByRole('button', { name: '知识问答', exact: true })).toBeVisible()
  await expect(canDoList.getByRole('button', { name: '数据分析', exact: true })).toBeVisible()
  await expect(canDoList.getByRole('button', { name: '预测预警', exact: true })).toBeVisible()
  await expect(canDoList.getByRole('button', { name: '巡检上报', exact: true })).toBeVisible()
  await expect(canDoList.getByRole('button', { name: '运维报告', exact: true })).toBeVisible()
  await expect(canDoList).not.toContainText('园区有什么补贴政策')
  await expect(canDoList).not.toContainText('如何预约会议室')
  await expect(canDoList).not.toContainText('物业报修电话')

  const dataAnalysis = canDoList.getByRole('button', { name: '数据分析', exact: true })
  await dataAnalysis.hover()
  const popover = page.locator('.can-do-popover')
  await expect(popover).toContainText('园区现在的用电负荷怎么样？今天总能耗多少？')
  await popover.hover()
  await expect(popover).toBeVisible()
  const [railBox, popoverBox] = await Promise.all([
    page.locator('.can-do-rail').boundingBox(),
    popover.boundingBox(),
  ])
  expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(railBox!.y + 1)
  const exampleBoxes = await popover
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()))
  expect(exampleBoxes[1]!.y).toBeGreaterThan(exampleBoxes[0]!.y)
  await page.screenshot({
    path: 'test-results/can-do-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })

  await popover.getByRole('button', { name: '园区现在的用电负荷怎么样？今天总能耗多少？' }).click()
  await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue(
    '园区现在的用电负荷怎么样？今天总能耗多少？',
  )
  await expect(popover).toHaveCount(0)

  const report = canDoList.getByRole('button', { name: '运维报告', exact: true })
  await report.hover()
  const reportPopover = page.locator('.can-do-popover')
  await expect(reportPopover).toBeVisible()
  await page.waitForTimeout(200)
  const [reportBox, reportPopoverBox] = await Promise.all([
    report.boundingBox(),
    reportPopover.boundingBox(),
  ])
  expect(reportPopoverBox!.x).toBeGreaterThan(railBox!.x + railBox!.width / 2)
  expect(
    Math.abs(reportPopoverBox!.x + reportPopoverBox!.width - (reportBox!.x + reportBox!.width)),
  ).toBeLessThanOrEqual(1)
  await page.screenshot({
    path: 'test-results/can-do-report-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
})

test('Can Do list remains usable on a narrow touch viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const canDoList = page.getByRole('region', { name: '可用能力' })
  await canDoList.getByRole('button', { name: '运维报告', exact: true }).click()
  const popover = page.locator('.can-do-popover')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('生成今天的运维日报')
  await page.waitForTimeout(200)
  await page.screenshot({
    path: 'test-results/can-do-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  await popover.getByRole('button', { name: '给我一份上周的运维周报' }).click()
  await expect(page.getByRole('textbox', { name: '向AI提问' })).toHaveValue(
    '给我一份上周的运维周报',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
