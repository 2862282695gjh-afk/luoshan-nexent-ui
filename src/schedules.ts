export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export interface ScheduleDraft {
  name: string
  prompt: string
  frequency: Frequency
  time: string
  date: string
  weekdays: number[]
  monthDay?: number
  yearMonth?: number
}
export interface DemoSchedule extends ScheduleDraft {
  id: string
  enabled: boolean
  createdAt: number
}
export const scheduleStorageKey = 'luoshan-demo-schedules-v1'
export const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const frequencyOptions = [
  { value: 'once', label: '仅一次' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'quarterly', label: '每季度' },
  { value: 'yearly', label: '每年' },
] as const
export const calendarFrequencies = ['monthly', 'quarterly', 'yearly']
function calendarError(task: ScheduleDraft) {
  if (!Number.isInteger(task.monthDay) || task.monthDay! < 1 || task.monthDay! > 31)
    return '请选择 1 到 31 日。'
  if (task.frequency === 'yearly') {
    if (!Number.isInteger(task.yearMonth) || task.yearMonth! < 1 || task.yearMonth! > 12)
      return '请选择有效的月份。'
    const max = new Date(Date.UTC(2001, task.yearMonth!, 0)).getUTCDate()
    if (task.monthDay! > max)
      return '该月份没有此日期。当前年度接口不支持 2 月 29 日，请选择其他日期。'
  }
  return ''
}
export function calendarCron(task: ScheduleDraft): string | null {
  if (
    !calendarFrequencies.includes(task.frequency) ||
    calendarError(task) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)
  )
    return null
  const [hour, minute] = task.time.split(':').map(Number)
  const months =
    task.frequency === 'monthly'
      ? '*'
      : task.frequency === 'quarterly'
        ? '1,4,7,10'
        : task.yearMonth
  return `${minute} ${hour} ${task.monthDay} ${months} *`
}
const day = 86_400_000
const offset = 8 * 3_600_000
export function beijingDate(now = Date.now()) {
  return new Date(now + offset).toISOString().slice(0, 10)
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function nextOccurrence(task: ScheduleDraft, now = Date.now()): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) return null
  if (task.frequency === 'once') {
    if (!validDate(task.date)) return null
    const time = Date.parse(`${task.date}T${task.time}:00+08:00`)
    return time > now ? time : null
  }
  if (calendarFrequencies.includes(task.frequency)) {
    if (calendarError(task)) return null
    const current = new Date(now + offset)
    for (let i = 0; i <= 12; i++) {
      const base = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + i, 1))
      const month = base.getUTCMonth() + 1
      if (task.frequency === 'quarterly' && (month - 1) % 3 !== 0) continue
      if (task.frequency === 'yearly' && month !== task.yearMonth) continue
      const date = `${base.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(task.monthDay).padStart(2, '0')}`
      if (!validDate(date)) continue
      const time = Date.parse(`${date}T${task.time}:00+08:00`)
      if (time > now) return time
    }
    return null
  }
  if (!['daily', 'weekly'].includes(task.frequency)) return null
  const today = Date.parse(`${beijingDate(now)}T${task.time}:00+08:00`)
  for (let i = 0; i <= 7; i++) {
    const time = today + i * day
    if (
      time > now &&
      (task.frequency === 'daily' || task.weekdays.includes(new Date(time + offset).getUTCDay()))
    )
      return time
  }
  return null
}
export function validateSchedule(task: ScheduleDraft, now = Date.now()): string {
  if (!task.name.trim()) return '请输入任务名称。'
  if (task.name.length > 60) return '任务名称不能超过 60 个字。'
  if (!task.prompt.trim()) return '请输入需要助手执行的任务内容。'
  if (task.prompt.length > 4000) return '任务内容不能超过 4000 个字。'
  if (!frequencyOptions.some((option) => option.value === task.frequency)) return '请选择执行频率。'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) return '请选择有效的执行时间。'
  if (
    task.frequency === 'weekly' &&
    (!task.weekdays.length || task.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  )
    return '请至少选择一个有效的执行日。'
  if (calendarFrequencies.includes(task.frequency) && calendarError(task))
    return calendarError(task)
  if (task.frequency === 'once' && !validDate(task.date)) return '请选择有效的执行日期。'
  if (nextOccurrence(task, now) === null) return '执行时间已过去，请选择未来的时间。'
  return ''
}
export function scheduleSummary(task: ScheduleDraft) {
  if (task.frequency === 'monthly') return `每月${task.monthDay}日 ${task.time}`
  if (task.frequency === 'quarterly')
    return `每季度${task.monthDay}日（1、4、7、10月） ${task.time}`
  if (task.frequency === 'yearly') return `每年${task.yearMonth}月${task.monthDay}日 ${task.time}`
  const frequency =
    task.frequency === 'once'
      ? task.date
      : task.frequency === 'daily'
        ? '每天'
        : task.weekdays
            .slice()
            .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
            .map((d) => weekdayLabels[d])
            .join('、')
  return `${frequency} ${task.time}`
}
export function formatOccurrence(time: number | null) {
  if (time === null) return '无后续计划'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(time)
}
export function decodeSchedules(raw: string | null): DemoSchedule[] {
  if (!raw) return []
  const values: unknown = JSON.parse(raw)
  if (!Array.isArray(values)) throw new Error('任务记录格式不正确')
  const ids = new Set<string>()
  return values.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('任务记录格式不正确')
    const t = value as DemoSchedule
    if (
      typeof t.id !== 'string' ||
      !t.id ||
      ids.has(t.id) ||
      typeof t.enabled !== 'boolean' ||
      !Number.isFinite(t.createdAt) ||
      typeof t.name !== 'string' ||
      typeof t.prompt !== 'string' ||
      typeof t.time !== 'string' ||
      typeof t.date !== 'string' ||
      !Array.isArray(t.weekdays) ||
      t.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      validateSchedule(t, 0)
    )
      throw new Error('任务记录格式不正确')
    ids.add(t.id)
    return {
      id: t.id,
      name: t.name,
      prompt: t.prompt,
      frequency: t.frequency,
      time: t.time,
      date: t.date,
      weekdays: [...new Set(t.weekdays)],
      ...(calendarFrequencies.includes(t.frequency) ? { monthDay: t.monthDay } : {}),
      ...(t.frequency === 'yearly' ? { yearMonth: t.yearMonth } : {}),
      enabled: t.enabled,
      createdAt: t.createdAt,
    }
  })
}
