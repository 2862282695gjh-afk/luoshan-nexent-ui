<script setup lang="ts">
import CalendarScheduleFields from './CalendarScheduleFields.vue'
import { frequencyOptions } from '../schedules'
import LiveAutomations from './LiveAutomations.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { uuid } from '../uuid'
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Clock3,
  Pause,
  Play,
  Plus,
  Pencil,
  Trash2,
  X,
} from 'lucide-vue-next'
import {
  beijingDate,
  decodeSchedules,
  formatOccurrence,
  nextOccurrence,
  scheduleStorageKey,
  scheduleSummary,
  validateSchedule,
  weekdayLabels,
  type DemoSchedule,
  type ScheduleDraft,
} from '../schedules'
const props = defineProps<{ open: boolean; initialPrompt: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const nameInput = ref<HTMLInputElement>()
const tasks = ref<DemoSchedule[]>([])
const tab = ref<'live' | 'demo'>('live')
const serviceBusy = ref(false)
const pending = ref<DemoSchedule | null>(null)
function close() {
  if (!serviceBusy.value) emit('close')
}
const editing = ref(false)
const editingId = ref<string | null>(null)
const error = ref('')
const notice = ref('')
const storageBlocked = ref(false)
const deleting = ref<string | null>(null)
const now = ref(Date.now())
const draft = ref<ScheduleDraft>(emptyDraft())
let ticker: ReturnType<typeof setInterval> | undefined
function emptyDraft(): ScheduleDraft {
  return {
    name: '',
    prompt: '',
    frequency: 'daily',
    time: '09:00',
    date: beijingDate(),
    weekdays: [1],
    monthDay: 1,
    yearMonth: 1,
  }
}
const next = computed(() => nextOccurrence(draft.value, now.value))
const enabledCount = computed(
  () => tasks.value.filter((t) => t.enabled && nextOccurrence(t, now.value) !== null).length,
)
function load() {
  storageBlocked.value = false
  try {
    tasks.value = decodeSchedules(localStorage.getItem(scheduleStorageKey))
  } catch {
    storageBlocked.value = true
    error.value = '本地任务记录无法读取，已停止修改以保护原记录。请检查浏览器存储后重新打开。'
  }
}
function persist(items: DemoSchedule[]): boolean {
  if (storageBlocked.value) return false
  try {
    // Detect edits from other tabs instead of silently overwriting them.
    if (
      JSON.stringify(decodeSchedules(localStorage.getItem(scheduleStorageKey))) !==
      JSON.stringify(tasks.value)
    ) {
      load()
      error.value = '任务已在其他页面更新，请核对列表后再操作。'
      return false
    }
    localStorage.setItem(scheduleStorageKey, JSON.stringify(items))
    tasks.value = decodeSchedules(JSON.stringify(items))
    return true
  } catch {
    error.value = '保存失败，浏览器存储不可用或空间不足。任务尚未保存，请重试。'
    return false
  }
}
async function create() {
  draft.value = { ...emptyDraft(), prompt: props.initialPrompt }
  editingId.value = null
  editing.value = true
  error.value = ''
  notice.value = ''
  deleting.value = null
  await nextTick()
  nameInput.value?.focus()
}
async function createExample() {
  await create()
  draft.value.name = '园区设备巡检日报'
  draft.value.prompt = '汇总园区设备运行状态、异常告警和待处理问题，生成每日巡检报告。'
}
function edit(task: DemoSchedule) {
  draft.value = {
    name: task.name,
    prompt: task.prompt,
    frequency: task.frequency,
    time: task.time,
    date: task.date,
    weekdays: [...task.weekdays],
    monthDay: task.monthDay ?? 1,
    yearMonth: task.yearMonth ?? 1,
  }
  editingId.value = task.id
  editing.value = true
  error.value = ''
  notice.value = ''
  deleting.value = null
}
function save() {
  error.value = validateSchedule(draft.value)
  if (error.value) return
  const existing = tasks.value.find((t) => t.id === editingId.value)
  const task: DemoSchedule = {
    ...draft.value,
    name: draft.value.name.trim(),
    prompt: draft.value.prompt.trim(),
    weekdays: [...new Set(draft.value.weekdays)],
    id: existing?.id || uuid(),
    enabled: existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? Date.now(),
  }
  if (!existing) {
    pending.value = task
    editing.value = false
    return
  }
  const items = existing
    ? tasks.value.map((t) => (t.id === task.id ? task : t))
    : [task, ...tasks.value]
  if (!persist(items)) return
  editing.value = false
  now.value = Date.now()
  notice.value = existing ? '任务修改已保存在本机。' : '演示任务已创建并保存在本机，不会实际执行。'
}
function confirmDemo() {
  if (!pending.value) return
  error.value = validateSchedule(pending.value)
  if (error.value) return
  if (!persist([pending.value, ...tasks.value])) return
  pending.value = null
  notice.value = '演示提案已确认并保存在本机，不会实际执行。'
}
function toggle(task: DemoSchedule) {
  error.value = ''
  notice.value = ''
  if (!task.enabled && nextOccurrence(task) === null) {
    error.value = '该任务时间已过，请先编辑为未来时间再启用。'
    return
  }
  if (persist(tasks.value.map((t) => (t.id === task.id ? { ...t, enabled: !t.enabled } : t))))
    notice.value = task.enabled ? '演示任务已暂停。' : '演示任务已启用，仍不会实际执行。'
}
function remove(task: DemoSchedule) {
  error.value = ''
  if (persist(tasks.value.filter((t) => t.id !== task.id))) {
    deleting.value = null
    notice.value = '演示任务已删除。'
  }
}
function back() {
  editing.value = false
  error.value = ''
  deleting.value = null
}
watch(
  () => props.open,
  async (open) => {
    clearInterval(ticker)
    if (!open) {
      dialog.value?.close()
      return
    }
    editing.value = false
    deleting.value = null
    notice.value = ''
    error.value = ''
    now.value = Date.now()
    load()
    await nextTick()
    dialog.value?.showModal()
    ticker = setInterval(() => {
      now.value = Date.now()
    }, 30_000)
  },
)
onBeforeUnmount(() => clearInterval(ticker))
</script>

<template>
  <dialog
    ref="dialog"
    class="tasks-dialog"
    aria-labelledby="tasks-title"
    @cancel.prevent="close"
    @close="emit('close')"
  >
    <header class="tasks-heading">
      <div class="tasks-heading-icon"><CalendarClock :size="24" /></div>
      <div>
        <h2 id="tasks-title">
          {{
            tab === 'demo' && editing ? (editingId ? '编辑定时任务' : '创建定时任务') : '定时任务'
          }}
        </h2>
        <p>把重复的园区工作安排好</p>
      </div>
      <span class="tasks-demo-tag">{{ tab === 'demo' ? '本地演示' : '主 API' }}</span>
      <button class="tasks-icon" aria-label="关闭定时任务" :disabled="serviceBusy" @click="close">
        <X :size="21" />
      </button>
    </header>
    <div class="task-tabs" role="group" aria-label="任务模式">
      <button
        :class="{ active: tab === 'live' }"
        :aria-pressed="tab === 'live'"
        :disabled="serviceBusy"
        @click="tab = 'live'"
      >
        服务端任务
      </button>
      <button
        :class="{ active: tab === 'demo' }"
        :aria-pressed="tab === 'demo'"
        :disabled="serviceBusy"
        @click="tab = 'demo'"
      >
        本地演示
      </button>
    </div>
    <LiveAutomations
      v-show="tab === 'live'"
      :active="open && tab === 'live'"
      :initial-prompt="initialPrompt"
      @busy="serviceBusy = $event"
    />
    <template v-if="tab === 'demo'">
      <div class="tasks-disclaimer">
        <Clock3 :size="16" />
        <span>仅保存在当前浏览器，用于演示创建流程，不会实际执行或发送通知。</span>
      </div>
      <p v-if="error" class="tasks-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="tasks-notice" role="status">
        <Check :size="16" />
        {{ notice }}
      </p>
      <article v-if="pending" class="task-card demo-proposal">
        <span class="task-status">待确认 · 演示提案尚未生效</span>
        <h3>{{ pending.name }}</h3>
        <p class="task-prompt">{{ pending.prompt }}</p>
        <p class="task-schedule">{{ scheduleSummary(pending) }} · 北京时间</p>
        <div class="task-bottom">
          <button class="secondary-button" @click="pending = null">放弃演示提案</button>
          <button class="primary-button" @click="confirmDemo">确认演示提案</button>
        </div>
      </article>
      <template v-if="!editing">
        <div class="tasks-list-heading">
          <span>共 {{ tasks.length }} 个任务 · {{ enabledCount }} 个已启用</span>
          <button
            class="primary-button"
            :disabled="storageBlocked || Boolean(pending)"
            @click="create"
          >
            <Plus :size="17" />
            创建定时任务
          </button>
        </div>
        <div v-if="!tasks.length" class="tasks-empty">
          <div><CalendarClock :size="36" /></div>
          <h3>让日常工作有个时间表</h3>
          <p>
            每天的设备巡检、每周的工单汇总，
            <br />
            先在这里安排一项任务。
          </p>
          <button class="tasks-example" :disabled="storageBlocked" @click="createExample">
            试试创建「设备巡检日报」
            <Plus :size="15" />
          </button>
        </div>
        <div v-else class="tasks-list">
          <article
            v-for="task in tasks"
            :key="task.id"
            class="task-card"
            :class="{ paused: !task.enabled }"
          >
            <div class="task-title-row">
              <h3>{{ task.name }}</h3>
              <span
                class="task-status"
                :class="{ enabled: task.enabled && nextOccurrence(task, now) !== null }"
              >
                {{
                  !task.enabled
                    ? '已暂停'
                    : nextOccurrence(task, now) === null
                      ? '计划时间已过'
                      : '已启用 · 演示'
                }}
              </span>
            </div>
            <p class="task-prompt">{{ task.prompt }}</p>
            <div class="task-schedule">
              <CalendarClock :size="15" />
              <strong>{{ scheduleSummary(task) }}</strong>
              <span>北京时间</span>
            </div>
            <div class="task-bottom">
              <span>
                {{
                  task.enabled
                    ? '下次计划：' + formatOccurrence(nextOccurrence(task, now))
                    : '已暂停，无后续计划'
                }}
              </span>
              <div>
                <button class="tasks-icon" :aria-label="`编辑 ${task.name}`" @click="edit(task)">
                  <Pencil :size="16" />
                </button>
                <button
                  class="tasks-icon"
                  :aria-label="`${task.enabled ? '暂停' : '启用'} ${task.name}`"
                  @click="toggle(task)"
                >
                  <Pause v-if="task.enabled" :size="16" />
                  <Play v-else :size="16" />
                </button>
                <button
                  class="tasks-icon"
                  :aria-label="`删除 ${task.name}`"
                  @click="deleting = task.id"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>
            <div v-if="deleting === task.id" class="task-delete-confirm">
              <span>删除此演示任务？</span>
              <button @click="deleting = null">取消</button>
              <button class="task-delete" @click="remove(task)">确认删除</button>
            </div>
          </article>
        </div>
      </template>
      <form v-else class="task-form" @submit.prevent="save">
        <div class="task-fields">
          <label>
            任务名称
            <input
              ref="nameInput"
              v-model="draft.name"
              maxlength="60"
              required
              placeholder="例如：园区设备巡检日报"
            />
          </label>
          <label>
            任务内容
            <textarea
              v-model="draft.prompt"
              aria-label="任务内容"
              maxlength="4000"
              required
              rows="4"
              placeholder="描述需要助手定期完成的工作，例如汇总设备异常并生成巡检报告。"
            ></textarea>
            <small>{{ draft.prompt.length }} / 4000</small>
          </label>
          <fieldset>
            <legend>执行频率</legend>
            <div class="task-frequency">
              <label
                v-for="option in frequencyOptions"
                :key="option.value"
                :class="{ selected: draft.frequency === option.value }"
              >
                <input
                  v-model="draft.frequency"
                  type="radio"
                  name="task-frequency"
                  :value="option.value"
                />
                {{ option.label }}
              </label>
            </div>
          </fieldset>
          <CalendarScheduleFields v-model="draft" />
          <fieldset v-if="draft.frequency === 'weekly'">
            <legend>执行日</legend>
            <div class="task-weekdays">
              <label
                v-for="day in [1, 2, 3, 4, 5, 6, 0]"
                :key="day"
                :class="{ selected: draft.weekdays.includes(day) }"
              >
                <input v-model="draft.weekdays" type="checkbox" :value="day" />
                {{ weekdayLabels[day] }}
              </label>
            </div>
          </fieldset>
          <div class="task-time-row">
            <label v-if="draft.frequency === 'once'">
              执行日期
              <input v-model="draft.date" type="date" :min="beijingDate(now)" required />
            </label>
            <label>
              执行时间
              <input v-model="draft.time" type="time" required />
            </label>
          </div>
        </div>
        <aside class="task-preview" aria-label="任务计划预览">
          <span class="task-preview-label">计划预览</span>
          <CalendarClock :size="28" />
          <h3>{{ draft.name.trim() || '新的定时任务' }}</h3>
          <p>{{ scheduleSummary(draft) }}</p>
          <div>
            <span>预计下次时间</span>
            <strong>{{ formatOccurrence(next) }}</strong>
          </div>
          <small>
            时区：北京时间（UTC+8）
            <br />
            演示模式，不会实际执行。
          </small>
        </aside>
        <footer class="task-form-footer">
          <button type="button" class="secondary-button" @click="back">
            <ArrowLeft :size="15" />
            返回列表
          </button>
          <button class="primary-button" :disabled="storageBlocked">
            {{ editingId ? '保存修改' : '生成演示提案' }}
          </button>
        </footer>
      </form>
    </template>
  </dialog>
</template>

<style scoped>
.task-tabs {
  display: flex;
  padding: 4px;
  gap: 4px;
  border-radius: 9px;
  background: #f2f6fa;
  margin: 20px 0;
}
.task-tabs button {
  flex: 1;
  padding: 10px;
  border-radius: 7px;
  font-size: 13px;
  color: #8797a7;
}
.task-tabs button.active {
  background: white;
  color: #087fba;
  box-shadow: 0 2px 8px #2a567411;
}
.demo-proposal {
  background: #f3faff;
  margin-bottom: 20px;
}
.tasks-dialog {
  width: 820px;
  max-width: calc(100vw - 32px);
  max-height: min(88dvh, 900px);
  padding: 28px;
  border: 1px solid #e1edf4;
  border-radius: 20px;
  color: #26394b;
  background: #fff;
  box-shadow: 0 24px 90px #10385830;
}
.tasks-dialog::backdrop {
  background: #182e4566;
  backdrop-filter: blur(3px);
}
.tasks-heading {
  display: flex;
  align-items: center;
  gap: 13px;
}
.tasks-heading-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: #eaf7ff;
  color: #0084c1;
  border-radius: 14px;
}
.tasks-heading h2 {
  font-size: 21px;
  margin: 0 0 5px;
}
.tasks-heading p {
  font-size: 12px;
  color: #91a1af;
  margin: 0;
}
.tasks-demo-tag {
  margin-left: auto;
  background: #f1f5fa;
  color: #8192a6;
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 5px;
}
.tasks-icon {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  color: #8194a5;
}
.tasks-icon:hover {
  background: #edf7fc;
  color: #007fbe;
}
.tasks-disclaimer {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  line-height: 1.7;
  color: #788b9c;
  background: #f7fafc;
  border: 1px solid #ecf2f6;
  border-radius: 9px;
  padding: 10px 12px;
  margin: 22px 0;
}
.tasks-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}
.tasks-list-heading > span {
  font-size: 12px;
  color: #8c9bab;
}
.tasks-empty {
  padding: 36px 0 46px;
  text-align: center;
}
.tasks-empty > div {
  width: 78px;
  height: 78px;
  background: #f0f8fe;
  color: #78b8db;
  border-radius: 50%;
  margin: 0 auto 20px;
  display: grid;
  place-items: center;
}
.tasks-empty h3 {
  font-size: 19px;
  margin: 0 0 12px;
  font-weight: 500;
}
.tasks-empty p {
  font-size: 13px;
  line-height: 1.9;
  color: #8d9dab;
}
.tasks-example {
  padding: 10px;
  font-size: 13px;
  color: #0087c7;
}
.tasks-list {
  display: grid;
  gap: 12px;
}
.task-card {
  border: 1px solid #e3edf4;
  border-radius: 12px;
  padding: 18px;
}
.task-card.paused {
  background: #fafbfd;
}
.task-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.task-title-row h3 {
  margin: 0;
  font-size: 16px;
  overflow-wrap: anywhere;
}
.task-status {
  font-size: 10px;
  white-space: nowrap;
  background: #edf1f5;
  color: #8c98a7;
  padding: 4px 8px;
  border-radius: 5px;
}
.task-status.enabled {
  background: #e9f8f2;
  color: #299578;
}
.task-prompt {
  font-size: 13px;
  color: #8493a2;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 94px;
  overflow-y: auto;
  margin: 10px 0 14px;
}
.task-schedule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #358bb7;
}
.task-schedule strong {
  font-weight: 500;
}
.task-schedule > span {
  color: #9aabba;
  font-size: 10px;
}
.task-bottom {
  border-top: 1px solid #edf2f6;
  margin-top: 14px;
  padding-top: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.task-bottom > span {
  font-size: 11px;
  color: #8fa0ae;
}
.task-bottom > div {
  display: flex;
  flex-shrink: 0;
}
.task-delete-confirm {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  background: #fff5f3;
  color: #98665b;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  margin-top: 8px;
}
.task-delete-confirm span {
  margin-right: auto;
}
.task-delete {
  color: #c3503e;
}
.task-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 224px;
  gap: 22px;
}
.task-fields {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
.task-fields label,
.task-fields legend {
  font-size: 13px;
  font-weight: 500;
}
.task-fields > label,
.task-time-row > label {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.task-fields input:not([type='radio']):not([type='checkbox']),
.task-fields textarea {
  border: 1px solid #dfe8ef;
  border-radius: 8px;
  width: 100%;
  min-width: 0;
  background: #fff;
  padding: 11px 12px;
  color: #384d5f;
  font-size: 14px;
}
.task-fields input:focus,
.task-fields textarea:focus {
  border-color: #61b6e2;
  box-shadow: 0 0 0 3px #eaf7ff;
}
.task-fields textarea {
  resize: vertical;
  line-height: 1.7;
  min-height: 108px;
  max-height: 220px;
}
.task-fields small {
  align-self: flex-end;
  font-size: 10px;
  font-weight: 400;
  color: #9faab7;
}
.task-fields fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.task-fields legend {
  padding: 0;
  margin-bottom: 10px;
}
.task-frequency,
.task-weekdays {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.task-frequency label,
.task-weekdays label {
  position: relative;
  cursor: pointer;
  border: 1px solid #e1e9f1;
  border-radius: 8px;
  padding: 10px;
  text-align: center;
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  font-weight: 400;
}
.task-frequency input,
.task-weekdays input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.task-frequency label:focus-within,
.task-weekdays label:focus-within {
  outline: 2px solid #84c8ec;
  outline-offset: 2px;
}
.task-frequency label.selected,
.task-weekdays label.selected {
  border-color: #8dc8e9;
  background: #eaf7ff;
  color: #0084c5;
}
.task-weekdays {
  gap: 5px;
  flex-wrap: wrap;
}
.task-weekdays label {
  padding: 10px 3px;
}
.task-time-row {
  display: flex;
  gap: 12px;
}
.task-time-row label {
  flex: 1;
  min-width: 0;
}
.task-preview {
  align-self: start;
  padding: 20px;
  background: linear-gradient(155deg, #eef8ff, #f8fbfd);
  border: 1px solid #e3f0f8;
  border-radius: 12px;
  min-width: 0;
}
.task-preview-label {
  display: block;
  color: #93a5b6;
  font-size: 11px;
  margin-bottom: 25px;
}
.task-preview > svg {
  color: #138ac4;
}
.task-preview h3 {
  font-size: 16px;
  line-height: 1.6;
  margin: 14px 0 10px;
  overflow-wrap: anywhere;
}
.task-preview p {
  font-size: 13px;
  line-height: 1.8;
  color: #438bab;
}
.task-preview > div {
  border-top: 1px solid #dbeaf4;
  padding-top: 16px;
  margin: 18px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-preview > div span {
  font-size: 11px;
  color: #91a5b5;
}
.task-preview > div strong {
  font-size: 18px;
  font-weight: 500;
}
.task-preview small {
  font-size: 10px;
  color: #93a6b7;
  line-height: 1.9;
}
.task-form-footer {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #edf2f5;
  padding-top: 18px;
}
.tasks-error {
  border-radius: 8px;
  background: #fff0ec;
  color: #b5573b;
  font-size: 13px;
  padding: 12px;
  line-height: 1.7;
}
.tasks-notice {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  border-radius: 8px;
  background: #eefaf5;
  color: #39836b;
  font-size: 12px;
  padding: 12px;
  line-height: 1.7;
}
@media (max-width: 767px) {
  .tasks-dialog {
    width: calc(100% - 20px);
    max-width: none;
    max-height: calc(var(--mobile-height, 100dvh) - 24px);
    padding: 18px;
    border-radius: 18px;
  }
  .tasks-heading {
    gap: 9px;
  }
  .tasks-heading-icon {
    display: none;
  }
  .tasks-heading h2 {
    font-size: 19px;
  }
  .tasks-disclaimer {
    margin: 18px 0;
    font-size: 11px;
  }
  .tasks-list-heading {
    flex-wrap: wrap;
  }
  .task-form {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .task-fields input:not([type='radio']):not([type='checkbox']),
  .task-fields textarea {
    font-size: 16px;
  }
  .task-preview {
    padding: 15px;
  }
  .task-preview-label {
    margin-bottom: 10px;
  }
  .task-preview > svg {
    display: none;
  }
  .task-preview > div {
    margin: 10px 0;
    padding-top: 10px;
  }
  .task-card {
    padding: 13px;
  }
  .task-title-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .tasks-icon {
    width: 40px;
    height: 40px;
  }
  .task-bottom {
    flex-wrap: wrap;
  }
  .task-weekdays {
    gap: 4px;
  }
  .task-weekdays label {
    font-size: 11px;
    min-height: 40px;
    padding: 12px 2px;
  }
  .task-form-footer {
    position: sticky;
    bottom: -18px;
    margin: 0 -2px -2px;
    padding: 12px 0;
    background: #fff;
  }
}
</style>
