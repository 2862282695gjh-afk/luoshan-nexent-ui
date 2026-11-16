import { expect, it } from 'vitest'
import { calendarCron, scheduleSummary, type ScheduleDraft } from '../src/schedules'
import { triggerText } from '../src/automations'
for (const [frequency, cron, label] of [
  ['monthly', '30 8 15 * *', '每月15日'],
  ['quarterly', '30 8 15 1,4,7,10 *', '每季度15日（1、4、7、10月）'],
  ['yearly', '30 8 15 12 *', '每年12月15日'],
] as const)
  it(`formats ${frequency} submission and the server-returned plan`, () => {
    const task: ScheduleDraft = {
      name: '报告',
      prompt: '汇总设备',
      frequency,
      time: '08:30',
      date: '',
      weekdays: [],
      monthDay: 15,
      yearMonth: 12,
    }
    expect(calendarCron(task)).toBe(cron)
    expect(scheduleSummary(task)).toBe(label + ' 08:30')
    expect(
      triggerText({
        mode: 'RECURRING',
        rule_type: 'CRON',
        timezone: 'Asia/Shanghai',
        start_at: '',
        cron_expr: cron,
      }),
    ).toBe(label + ' 08:30 · Asia/Shanghai')
  })
