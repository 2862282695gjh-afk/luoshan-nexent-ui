import { describe, expect, it } from 'vitest'
import {
  beijingDate,
  decodeSchedules,
  nextOccurrence,
  validateSchedule,
  type ScheduleDraft,
} from '../src/schedules'
const task: ScheduleDraft = {
  name: '设备日报',
  prompt: '汇总设备异常',
  frequency: 'daily',
  time: '09:00',
  date: '2026-09-18',
  weekdays: [1],
}
describe('demo schedule calculation in Asia/Shanghai', () => {
  it('rolls daily schedules forward at or after the scheduled minute', () => {
    expect(nextOccurrence(task, Date.parse('2026-09-18T00:59:00Z'))).toBe(
      Date.parse('2026-09-18T01:00:00Z'),
    )
    expect(nextOccurrence(task, Date.parse('2026-09-18T01:00:00Z'))).toBe(
      Date.parse('2026-09-19T01:00:00Z'),
    )
  })
  it('uses Beijing dates regardless of the host timezone', () => {
    expect(beijingDate(Date.parse('2026-09-18T18:00:00Z'))).toBe('2026-09-19')
    expect(nextOccurrence({ ...task, time: '00:15' }, Date.parse('2026-09-18T15:59:00Z'))).toBe(
      Date.parse('2026-09-18T16:15:00Z'),
    )
  })
  it('finds the next selected weekly day including Sunday and next week', () => {
    expect(
      nextOccurrence(
        { ...task, frequency: 'weekly', weekdays: [1, 5] },
        Date.parse('2026-09-18T02:00:00Z'),
      ),
    ).toBe(Date.parse('2026-09-21T01:00:00Z'))
    expect(
      nextOccurrence(
        { ...task, frequency: 'weekly', weekdays: [0] },
        Date.parse('2026-09-20T01:00:00Z'),
      ),
    ).toBe(Date.parse('2026-09-27T01:00:00Z'))
  })
  it('does not turn an expired once-only schedule into a completed task', () => {
    const once = { ...task, frequency: 'once' as const }
    expect(nextOccurrence(once, Date.parse('2026-09-18T00:00:00Z'))).toBe(
      Date.parse('2026-09-18T01:00:00Z'),
    )
    expect(nextOccurrence(once, Date.parse('2026-09-18T02:00:00Z'))).toBeNull()
    expect(validateSchedule(once, Date.parse('2026-09-18T02:00:00Z'))).toContain('时间已过去')
  })
  it('rejects missing fields, invalid dates/times and empty weekly selection', () => {
    expect(validateSchedule({ ...task, name: '  ' })).toContain('名称')
    expect(validateSchedule({ ...task, prompt: '  ' })).toContain('内容')
    expect(validateSchedule({ ...task, time: '25:00' })).toContain('时间')
    expect(validateSchedule({ ...task, frequency: 'weekly', weekdays: [] })).toContain('执行日')
    expect(validateSchedule({ ...task, frequency: 'once', date: '2026-02-30' }, 0)).toContain(
      '日期',
    )
  })
  it('loads expired tasks but rejects corrupt or duplicate stored records', () => {
    const stored = { ...task, frequency: 'once', id: 'a', enabled: true, createdAt: 1 }
    expect(decodeSchedules(JSON.stringify([stored]))[0]).toMatchObject({
      id: 'a',
      frequency: 'once',
    })
    expect(() => decodeSchedules('{broken')).toThrow()
    expect(() => decodeSchedules(JSON.stringify([stored, stored]))).toThrow()
    expect(() => decodeSchedules(JSON.stringify([{ ...stored, weekdays: 'Monday' }]))).toThrow()
    expect(decodeSchedules(null)).toEqual([])
  })
})

describe('calendar recurrence', () => {
  const calendar = { ...task, monthDay: 31, yearMonth: 12 }
  it('skips missing dates without rolling into the following month', () => {
    expect(
      nextOccurrence({ ...calendar, frequency: 'monthly' }, Date.parse('2026-04-01T00:00:00Z')),
    ).toBe(Date.parse('2026-05-31T01:00:00Z'))
    expect(
      nextOccurrence({ ...calendar, frequency: 'quarterly' }, Date.parse('2026-02-01T00:00:00Z')),
    ).toBe(Date.parse('2026-07-31T01:00:00Z'))
  })
  it('uses calendar quarters and rolls yearly schedules across years', () => {
    expect(
      nextOccurrence(
        { ...calendar, frequency: 'quarterly', monthDay: 1 },
        Date.parse('2026-10-01T01:00:00Z'),
      ),
    ).toBe(Date.parse('2027-01-01T01:00:00Z'))
    expect(
      nextOccurrence({ ...calendar, frequency: 'yearly' }, Date.parse('2026-12-31T01:00:00Z')),
    ).toBe(Date.parse('2027-12-31T01:00:00Z'))
  })
  it('rejects invalid dates and the yearly leap-day unsupported by the current backend parser', () => {
    for (const monthDay of [0, 32, 1.5, undefined])
      expect(validateSchedule({ ...calendar, frequency: 'monthly', monthDay })).not.toBe('')
    expect(validateSchedule({ ...calendar, frequency: 'yearly', yearMonth: 4 })).toContain('日期')
    expect(
      validateSchedule({ ...calendar, frequency: 'yearly', yearMonth: 2, monthDay: 29 }),
    ).toContain('2 月 29 日')
    expect(validateSchedule({ ...calendar, frequency: 'yearly', yearMonth: 13 })).toContain('月份')
  })
  it('persists month/day fields while remaining compatible with old daily records', () => {
    const stored = { ...calendar, frequency: 'yearly', id: 'calendar', enabled: true, createdAt: 1 }
    expect(decodeSchedules(JSON.stringify([stored]))[0]).toMatchObject({
      frequency: 'yearly',
      monthDay: 31,
      yearMonth: 12,
    })
    expect(
      decodeSchedules(
        JSON.stringify([
          { ...stored, frequency: 'daily', monthDay: undefined, yearMonth: undefined },
        ]),
      )[0]?.frequency,
    ).toBe('daily')
  })
})
