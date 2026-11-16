import { ApiError, request } from './api'
export interface AutomationAgent {
  id: number
  name: string
  displayName: string
  available: boolean
}
export interface AutomationTrigger {
  mode: string
  rule_type: string
  timezone: string
  start_at: string
  cron_expr?: string | null
  interval_seconds?: number | null
  end_at?: string | null
  max_fire_count?: number | null
}
export interface AutomationTask {
  task_id: number
  title: string
  instruction: string
  status: string
  agent_id: number
  agent_name?: string
  conversation_id: number
  schedule_config: AutomationTrigger
  next_fire_at?: string | null
}
export interface AutomationProposal {
  proposal_id: number | null
  conversation_id?: number
  executable: boolean
  task: {
    title: string
    instruction: string
    agent_id: number
    agent_name?: string
    schedule_trigger: AutomationTrigger
  } | null
  capability_resolution?: {
    missing_capabilities?: { name?: string; reason?: string; description?: string }[]
    executable?: boolean
  }
}
async function call<T>(suffix: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    const value = await request('/api/automations' + suffix, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (value?.code !== 0 || !('data' in value))
      throw new Error(
        typeof value?.message === 'string' ? value.message : '任务接口返回格式不符合预期。',
      )
    return value.data as T
  } catch (e) {
    if (e instanceof ApiError && e.status === 401)
      throw new Error('任务主 API 登录凭据无效或已过期，请更新服务端 NEXENT_USER_TOKEN 并重启。')
    throw e
  }
}
export const automations = {
  agents: () => call<AutomationAgent[]>('/agents'),
  list: (page = 1) =>
    call<{ items: AutomationTask[]; total: number }>('?page=' + page + '&page_size=20'),
  proposal: (body: { agent_id: number; message: string; timezone: string }) =>
    call<AutomationProposal>('/proposals', 'POST', body),
  confirm: (id: number) => call<AutomationTask>(`/proposals/${id}/confirm`, 'POST', {}),
  detail: (id: number) => call<AutomationTask>(`/${id}`),
  pause: (id: number) => call<AutomationTask>(`/${id}/pause`, 'POST'),
  resume: (id: number) => call<AutomationTask>(`/${id}/resume`, 'POST'),
  remove: (id: number) => call<boolean>(`/${id}`, 'DELETE'),
}
export function triggerText(trigger?: AutomationTrigger) {
  if (!trigger) return '未返回执行计划'
  const zone = trigger.timezone || '未指定时区'
  if (trigger.mode === 'ONCE') return `仅一次 · ${trigger.start_at} · ${zone}`
  if (trigger.rule_type === 'INTERVAL') return `每 ${trigger.interval_seconds} 秒 · ${zone}`
  const calendar = trigger.cron_expr?.trim().match(/^(\d+) (\d+) (\d+) (\*|\d+|1,4,7,10) \*$/)
  if (calendar) {
    const [, minute, hour, day, month] = calendar
    const frequency =
      month === '*'
        ? `每月${Number(day)}日`
        : month === '1,4,7,10'
          ? `每季度${Number(day)}日（1、4、7、10月）`
          : `每年${Number(month)}月${Number(day)}日`
    return `${frequency} ${hour!.padStart(2, '0')}:${minute!.padStart(2, '0')} · ${zone}`
  }
  const match = trigger.cron_expr?.match(/^(\d+) (\d+) \* \* (\*|[0-6](?:,[0-6])*)$/)
  if (match) {
    const time = match[2]!.padStart(2, '0') + ':' + match[1]!.padStart(2, '0')
    const days =
      match[3] === '*'
        ? '每天'
        : match[3]!
            .split(',')
            .map((d) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][Number(d)])
            .join('、')
    return `${days} ${time} · ${zone}`
  }
  return `Cron ${trigger.cron_expr || '未提供'} · ${zone}`
}
