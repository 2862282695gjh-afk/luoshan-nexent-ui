<script setup lang="ts">
import CalendarScheduleFields from './CalendarScheduleFields.vue'
import { calendarCron, frequencyOptions } from '../schedules'
import { computed, ref, watch } from 'vue'
import { CalendarClock, RefreshCw, Plus, Pause, Play, Trash2 } from 'lucide-vue-next'
import { request } from '../api'
import {
  automations,
  triggerText,
  type AutomationProposal,
  type AutomationTask,
  type AutomationAgent,
} from '../automations'
import { beijingDate, scheduleSummary, validateSchedule, type ScheduleDraft } from '../schedules'
const props = defineProps<{ active: boolean; initialPrompt: string }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const ready = ref(false)
const configured = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const creating = ref(false)
const agentId = ref<number | null>(null)
const agents = ref<AutomationAgent[]>([])
const agentError = ref('')
const selectedAgent = computed(() =>
  agents.value.find((agent) => agent.id === agentId.value && agent.available),
)
function agentLabel(agent: AutomationAgent) {
  return agents.value.filter((item) => item.displayName === agent.displayName).length > 1
    ? `${agent.displayName}（${agent.name}）`
    : agent.displayName
}
const tasks = ref<AutomationTask[]>([])
const proposal = ref<AutomationProposal | null>(null)
const expectedCron = ref<string | null>(null)
const scheduleMatches = computed(() => {
  if (!expectedCron.value) return true
  const trigger = proposal.value?.task?.schedule_trigger
  return (
    trigger?.mode === 'RECURRING' &&
    trigger.rule_type === 'CRON' &&
    trigger.timezone === 'Asia/Shanghai' &&
    trigger.cron_expr?.trim().replace(/\s+/g, ' ') === expectedCron.value
  )
})
const confirmUncertain = ref(false)
const page = ref(1)
const total = ref(0)
const deleting = ref<number | null>(null)
const draft = ref<ScheduleDraft>({
  name: '',
  prompt: '',
  frequency: 'daily',
  date: beijingDate(),
  time: '09:00',
  weekdays: [1],
  monthDay: 1,
  yearMonth: 1,
})
const canConfirm = computed(() =>
  Boolean(
    proposal.value?.proposal_id &&
    proposal.value.executable === true &&
    proposal.value.task?.schedule_trigger &&
    proposal.value.capability_resolution?.executable !== false &&
    !proposal.value.capability_resolution?.missing_capabilities?.length &&
    !confirmUncertain.value &&
    scheduleMatches.value,
  ),
)
const statusLabels: Record<string, string> = {
  ACTIVE: '已启用',
  PAUSED: '已暂停',
  PAUSED_BY_SYSTEM: '系统暂停',
  COMPLETED: '已完成',
  DRAFT: '草稿',
  DELETED: '已删除',
}
function setBusy(value: boolean) {
  busy.value = value
  emit('busy', value)
}
function message(e: unknown) {
  return e instanceof Error ? e.message : '操作失败，请重试。'
}
async function refresh() {
  const data = await automations.list(page.value)
  if (!Array.isArray(data.items) || !Number.isFinite(data.total))
    throw new Error('任务列表格式不符合预期。')
  tasks.value = data.items
  total.value = data.total
}
async function loadAgents(defaultId?: number) {
  agents.value = []
  agentError.value = ''
  try {
    const list = await automations.agents()
    if (!Array.isArray(list)) throw new Error('智能体列表格式不符合预期。')
    agents.value = list
    if (!selectedAgent.value)
      agentId.value = list.find((agent) => agent.id === defaultId && agent.available)?.id ?? null
  } catch (e) {
    agentError.value = '智能体列表加载失败：' + message(e)
  }
}
async function load() {
  if (busy.value) return
  setBusy(true)
  error.value = ''
  try {
    const config = await request('/api/config')
    configured.value = config.automationConfigured === true
    ready.value = true
    if (configured.value) await Promise.all([refresh(), loadAgents(config.automationAgentId)])
  } catch (e) {
    error.value = message(e)
  } finally {
    setBusy(false)
  }
}
function create() {
  draft.value = {
    name: '',
    prompt: props.initialPrompt,
    frequency: 'daily',
    date: beijingDate(),
    time: '09:00',
    weekdays: [1],
    monthDay: 1,
    yearMonth: 1,
  }
  creating.value = true
  notice.value = ''
  error.value = ''
}
async function createProposal() {
  if (busy.value || proposal.value) return
  error.value = validateSchedule(draft.value)
  if (error.value) return
  if (!selectedAgent.value) {
    error.value = '请选择可用的执行智能体。'
    return
  }
  setBusy(true)
  try {
    expectedCron.value = calendarCron(draft.value)
    const p = await automations.proposal({
      agent_id: selectedAgent.value.id,
      message: `创建定时任务，名称：${draft.value.name}。请在北京时间${scheduleSummary(draft.value)}执行以下工作：${draft.value.prompt}`,
      timezone: 'Asia/Shanghai',
    })
    if (!Number.isInteger(p.proposal_id) || !p.proposal_id || !p.task)
      throw new Error('服务端未生成可确认提案，请明确执行时间和任务内容后重试。')
    proposal.value = p
    creating.value = false
    confirmUncertain.value = false
  } catch (e) {
    error.value =
      message(e) + ' 若请求超时，提案可能已保存，请先在 Nexent 会话中核查，避免重复创建。'
  } finally {
    setBusy(false)
  }
}
function deferProposal() {
  proposal.value = null
  error.value = ''
  notice.value = '未启用任务。服务端待确认提案仍保留在对应 Nexent 会话中。'
}
async function confirm() {
  if (!canConfirm.value || busy.value) return
  setBusy(true)
  error.value = ''
  notice.value = ''
  try {
    const task = await automations.confirm(proposal.value!.proposal_id!)
    if (!Number.isInteger(task.task_id) || typeof task.status !== 'string')
      throw new Error('确认响应缺少任务状态')
    proposal.value = null
    notice.value = `任务「${task.title}」已确认，服务端状态：${statusLabels[task.status] || task.status}。`
    page.value = 1
    try {
      await refresh()
    } catch (e) {
      error.value = '任务已确认，但列表刷新失败：' + message(e)
    }
  } catch (e) {
    confirmUncertain.value = true
    error.value =
      message(e) +
      ' 确认结果尚未核实，已禁止重复确认。请刷新任务列表并在 Nexent 中核对，不要重新建任务。'
  } finally {
    setBusy(false)
  }
}
async function action(task: AutomationTask, type: 'pause' | 'resume' | 'remove') {
  if (busy.value) return
  setBusy(true)
  error.value = ''
  notice.value = ''
  try {
    await automations[type](task.task_id)
    deleting.value = null
    notice.value = '操作已提交至服务端。'
    await refresh()
  } catch (e) {
    error.value = message(e) + ' 请刷新列表核对状态后再操作。'
  } finally {
    setBusy(false)
  }
}
async function changePage(delta: number) {
  page.value += delta
  await load()
}
watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)
</script>
<template>
  <section class="live-tasks">
    <p class="live-intro">通过 Nexent 主 API 创建提案；核对服务端返回的计划后，点击确认才生效。</p>
    <p v-if="error" role="alert" class="live-error">{{ error }}</p>
    <p v-if="notice" role="status" class="live-notice">{{ notice }}</p>
    <div v-if="ready && !configured" class="live-setup">
      <CalendarClock :size="32" />
      <h3>尚未连接任务主 API</h3>
      <p>
        北向 access_key 不能用于此接口。请在服务端 .env 配置主 API
        地址和用户登录凭据，然后重启前端服务。
      </p>
      <pre>
NEXENT_MAIN_API_URL=主API根地址或网关/api地址
NEXENT_USER_TOKEN=用户登录JWT
NEXENT_AUTOMATION_AGENT_ID=任务智能体数字ID</pre>
      <p>
        若后端为 Nexent 免登录开发模式，可设置 NEXENT_AUTOMATION_AUTH_MODE=speed；正常部署仍需 JWT。
      </p>
      <p>JWT 只由代理服务读取，不在浏览器中输入。也可切换“本地演示”体验流程。</p>
      <button class="secondary-button" :disabled="busy" @click="load">检查连接</button>
    </div>
    <template v-else-if="configured">
      <div v-if="proposal" class="proposal-card">
        <span class="proposal-label">
          {{ confirmUncertain ? '待核实确认结果' : '待您确认 · 尚未生效' }}
        </span>
        <h3>{{ proposal.task?.title }}</h3>
        <p class="proposal-instruction">{{ proposal.task?.instruction }}</p>
        <dl>
          <dt>执行智能体</dt>
          <dd>
            {{
              agents.find((agent) => agent.id === proposal?.task?.agent_id)?.displayName ||
              proposal.task?.agent_name ||
              '未返回智能体名称'
            }}
          </dd>
          <dt>执行计划</dt>
          <dd>{{ triggerText(proposal.task?.schedule_trigger) }}</dd>
          <dt>开始时间</dt>
          <dd>{{ proposal.task?.schedule_trigger?.start_at }}</dd>
          <template v-if="proposal.task?.schedule_trigger?.end_at">
            <dt>结束时间</dt>
            <dd>{{ proposal.task.schedule_trigger.end_at }}</dd>
          </template>
          <template v-if="proposal.task?.schedule_trigger?.max_fire_count">
            <dt>执行次数上限</dt>
            <dd>{{ proposal.task.schedule_trigger.max_fire_count }}</dd>
          </template>
          <dt>关联会话</dt>
          <dd>{{ proposal.conversation_id || '未返回' }}</dd>
          <dt>提案编号</dt>
          <dd>{{ proposal.proposal_id }}</dd>
        </dl>
        <p v-if="!proposal.executable" class="live-error">当前智能体能力不足，此提案不能确认。</p>
        <p v-if="!scheduleMatches" class="live-error" role="alert">
          后端返回的执行计划与所选日期、频率或时间不一致，已禁止启用。请暂不确认并核查后端计划解析。
        </p>
        <ul v-if="proposal.capability_resolution?.missing_capabilities?.length">
          <li v-for="(cap, i) in proposal.capability_resolution.missing_capabilities" :key="i">
            {{ cap.name || cap.description || '缺少必要能力' }} {{ cap.reason }}
          </li>
        </ul>
        <p class="proposal-help">
          以上为服务端解析后的实际计划。请核对内容和时间；当前页面关闭后可重新打开继续确认，刷新页面后请到
          Nexent 对应会话核查提案。
        </p>
        <div class="live-actions">
          <button
            v-if="!confirmUncertain"
            class="secondary-button"
            :disabled="busy"
            @click="deferProposal"
          >
            暂不确认
          </button>
          <button class="secondary-button" :disabled="busy" @click="load">刷新任务列表</button>
          <button class="primary-button" :disabled="!canConfirm || busy" @click="confirm">
            {{ busy ? '处理中…' : '确认并启用任务' }}
          </button>
        </div>
      </div>
      <form v-else-if="creating" class="live-form" @submit.prevent="createProposal">
        <label>
          任务名称
          <input v-model="draft.name" maxlength="60" required :disabled="busy" />
        </label>
        <label>
          任务内容
          <textarea
            v-model="draft.prompt"
            rows="4"
            maxlength="4000"
            required
            :disabled="busy"
          ></textarea>
        </label>
        <label for="task-agent">执行智能体</label>
        <select
          id="task-agent"
          v-model.number="agentId"
          required
          :disabled="busy || !agents.some((agent) => agent.available)"
        >
          <option :value="null" disabled>请选择智能体</option>
          <option
            v-for="agent in agents"
            :key="agent.id"
            :value="agent.id"
            :disabled="!agent.available"
          >
            {{ agentLabel(agent) }}{{ agent.available ? '' : '（暂不可用）' }}
          </option>
        </select>
        <p v-if="agentError" class="live-error" role="alert">{{ agentError }}</p>
        <p v-else-if="!busy && !agents.some((agent) => agent.available)" class="live-intro">
          暂无可用智能体，请先在 Nexent 发布智能体。
        </p>
        <button
          v-if="agentError || !agents.some((agent) => agent.available)"
          type="button"
          class="secondary-button"
          :disabled="busy"
          @click="load"
        >
          重新加载智能体
        </button>
        <div class="live-time-row">
          <label>
            执行频率
            <select v-model="draft.frequency" aria-label="执行频率" :disabled="busy">
              <option v-for="option in frequencyOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            执行时间
            <input v-model="draft.time" type="time" required :disabled="busy" />
          </label>
        </div>
        <CalendarScheduleFields v-model="draft" :disabled="busy" />
        <fieldset v-if="draft.frequency === 'weekly'">
          <legend>执行日</legend>
          <label
            v-for="(label, day) in ['周日', '周一', '周二', '周三', '周四', '周五', '周六']"
            :key="day"
          >
            <input v-model="draft.weekdays" type="checkbox" :value="day" :disabled="busy" />
            {{ label }}
          </label>
        </fieldset>
        <label v-if="draft.frequency === 'once'">
          执行日期
          <input v-model="draft.date" type="date" :min="beijingDate()" required :disabled="busy" />
        </label>
        <p class="live-intro">
          时间按北京时间提交。此步骤仅生成提案，不会启用任务；后端可能整理任务内容，请在下一步核对。
        </p>
        <div class="live-actions">
          <button type="button" class="secondary-button" :disabled="busy" @click="creating = false">
            返回列表
          </button>
          <button class="primary-button" :disabled="busy || !selectedAgent">
            {{ busy ? '正在生成提案…' : '生成待确认提案' }}
          </button>
        </div>
      </form>
      <div v-if="!creating" class="live-list">
        <div class="live-actions">
          <span>服务端任务 · 共 {{ total }} 项</span>
          <button class="secondary-button" :disabled="busy" @click="load">
            <RefreshCw :size="15" />
            刷新
          </button>
          <button class="primary-button" :disabled="busy || Boolean(proposal)" @click="create">
            <Plus :size="15" />
            创建定时任务
          </button>
        </div>
        <p v-if="!tasks.length" class="live-empty">
          {{ busy ? '正在读取任务…' : '暂无任务。创建提案并确认后，任务会出现在这里。' }}
        </p>
        <article v-for="task in tasks" :key="task.task_id" class="live-task">
          <div>
            <h3>{{ task.title }}</h3>
            <span>{{ statusLabels[task.status] || task.status }}</span>
          </div>
          <p>{{ task.instruction }}</p>
          <small>{{ triggerText(task.schedule_config) }}</small>
          <p class="live-next">下次执行（服务端）：{{ task.next_fire_at || '暂无' }}</p>
          <div class="live-actions">
            <button
              v-if="task.status === 'ACTIVE'"
              class="secondary-button"
              :disabled="busy"
              :aria-label="`暂停 ${task.title}`"
              @click="action(task, 'pause')"
            >
              <Pause :size="14" />
              暂停
            </button>
            <button
              v-if="['PAUSED', 'PAUSED_BY_SYSTEM'].includes(task.status)"
              class="secondary-button"
              :disabled="busy"
              :aria-label="`恢复 ${task.title}`"
              @click="action(task, 'resume')"
            >
              <Play :size="14" />
              恢复
            </button>
            <button
              class="secondary-button"
              :disabled="busy"
              :aria-label="`删除 ${task.title}`"
              @click="deleting = task.task_id"
            >
              <Trash2 :size="14" />
              删除
            </button>
          </div>
          <div v-if="deleting === task.task_id" class="live-delete">
            <span>确定删除服务端任务？</span>
            <button :disabled="busy" @click="deleting = null">取消</button>
            <button :disabled="busy" @click="action(task, 'remove')">确认删除</button>
          </div>
        </article>
        <div v-if="total > 20" class="live-actions">
          <button class="secondary-button" :disabled="busy || page <= 1" @click="changePage(-1)">
            上一页
          </button>
          <span>第 {{ page }} 页</span>
          <button
            class="secondary-button"
            :disabled="busy || page * 20 >= total"
            @click="changePage(1)"
          >
            下一页
          </button>
        </div>
      </div>
    </template>
    <p v-else class="live-empty">
      {{ busy ? '正在读取连接配置…' : '连接配置尚未读取' }}
      <button :disabled="busy" @click="load">重试</button>
    </p>
  </section>
</template>
<style scoped>
.live-intro,
.proposal-help {
  font-size: 12px;
  line-height: 1.8;
  color: #8799aa;
}
.live-error,
.live-notice {
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.8;
}
.live-error {
  background: #fff2ec;
  color: #b36547;
}
.live-notice {
  background: #eff9f4;
  color: #35846a;
}
.live-setup {
  padding: 28px 10px;
  text-align: center;
  color: #7b95a7;
}
.live-setup > svg {
  color: #238fc9;
}
.live-setup h3 {
  color: #385269;
  font-size: 18px;
}
.live-setup p {
  font-size: 13px;
  line-height: 1.8;
}
.live-setup pre {
  background: #f4f8fc;
  text-align: left;
  padding: 15px;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.live-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}
.live-form > label,
.live-time-row > label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.live-form input:not([type='checkbox']),
.live-form select,
.live-form textarea {
  border: 1px solid #dce7f0;
  border-radius: 8px;
  padding: 10px;
  width: 100%;
  min-width: 0;
  font-size: 14px;
  color: #34556b;
}
.live-form textarea {
  resize: vertical;
  min-height: 90px;
  max-height: 240px;
}
.live-form input:focus,
.live-form textarea:focus,
.live-form select:focus {
  border-color: #44a7da;
  box-shadow: 0 0 0 3px #eaf6ff;
}
.live-form small {
  font-size: 11px;
  color: #94a6b5;
}
.live-form fieldset {
  border: 1px solid #e6eef4;
  border-radius: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 13px;
  font-size: 13px;
}
.live-form fieldset label {
  display: flex;
  gap: 5px;
  align-items: center;
}
.live-time-row {
  display: flex;
  gap: 15px;
}
.live-time-row > label {
  flex: 1;
  min-width: 0;
}
.live-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  margin: 16px 0;
}
.live-actions > span {
  margin-right: auto;
  font-size: 12px;
  color: #8197a7;
}
.live-empty {
  text-align: center;
  padding: 30px 10px;
  font-size: 13px;
  color: #91a3b3;
}
.proposal-card {
  background: #f4faff;
  border: 1px solid #cae5f5;
  padding: 22px;
  border-radius: 12px;
  margin: 18px 0;
}
.proposal-label {
  font-size: 12px;
  color: #ad8129;
  background: #fff5dc;
  padding: 5px 10px;
  border-radius: 6px;
}
.proposal-card h3 {
  font-size: 19px;
  color: #294e68;
}
.proposal-instruction {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.8;
  max-height: 220px;
  overflow-y: auto;
}
.proposal-card dl {
  display: grid;
  grid-template-columns: 85px 1fr;
  gap: 12px;
  font-size: 12px;
  line-height: 1.6;
}
.proposal-card dt {
  color: #8b9fae;
}
.proposal-card dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.proposal-card ul {
  font-size: 12px;
  color: #a56841;
}
.live-task {
  padding: 18px;
  border: 1px solid #e0ebf2;
  border-radius: 12px;
  margin-bottom: 12px;
}
.live-task > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.live-task h3 {
  font-size: 16px;
  margin: 0;
  overflow-wrap: anywhere;
}
.live-task > div > span {
  font-size: 12px;
  color: #4c977d;
}
.live-task p {
  font-size: 13px;
  line-height: 1.8;
  color: #8a9aab;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 140px;
  overflow: auto;
}
.live-task small {
  font-size: 12px;
  color: #4389af;
  overflow-wrap: anywhere;
}
.live-task .live-next {
  font-size: 11px;
}
.live-delete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: #b4614c;
  background: #fff4ef;
  padding: 10px;
}
@media (max-width: 767px) {
  .proposal-card {
    padding: 16px;
  }
  .live-form input:not([type='checkbox']),
  .live-form select,
  .live-form textarea {
    font-size: 16px;
  }
  .live-setup {
    padding: 18px 0;
  }
  .live-setup pre {
    font-size: 11px;
  }
  .live-actions {
    gap: 7px;
  }
  .live-task {
    padding: 13px;
  }
}
</style>
