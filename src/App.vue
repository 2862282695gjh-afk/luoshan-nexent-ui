<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { uuid } from './uuid'
import {
  Home,
  Bot,
  ChartPie,
  BookMarked,
  ContactRound,
  Bell,
  UserRound,
  Search,
  MessageSquarePlus,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  ArrowDown,
  Paperclip,
  Send,
  Square,
  Copy,
  Check,
  Ellipsis,
  Pencil,
  X,
  Settings2,
  CircleHelp,
  Plug,
  RefreshCw,
  LoaderCircle,
  Sparkles,
  Menu,
  Maximize2,
  Minimize2,
  CalendarClock,
  Trash2,
} from 'lucide-vue-next'
import MarkdownMessage from './components/MarkdownMessage.vue'
import AssistantEmblem from './components/AssistantEmblem.vue'
import CanDoList from './components/CanDoList.vue'
import ScheduledTasks from './components/ScheduledTasks.vue'
import MessageProcess from './components/MessageProcess.vue'
import { recordProcessEvent, settleProcessEvents } from './process-events'
import { api, eventText, runChat } from './api'
import { demoAnswer, seedConversations } from './demo'
import type { Agent, Conversation, Message, Model, StreamEvent } from './types'

const mode = ref<'demo' | 'live'>('demo')
const configured = ref(false)
const booting = ref(true)
const connected = ref(false)
const connecting = ref(false)
const settings = ref(false)
const tasksOpen = ref(false)
function openTasks() {
  closeHistory()
  tasksOpen.value = true
}
const infoPanel = ref<'notifications' | 'profile' | null>(null)
const collapsed = ref(false)
const mobileQuery = window.matchMedia('(max-width: 767px)')
const isMobile = ref(mobileQuery.matches)
const mobileHeight = ref(window.visualViewport?.height || window.innerHeight)
const historyOpen = ref(false)
const editorOpen = ref(false)
const sidebarElement = ref<HTMLElement>()
const editorDialog = ref<HTMLDialogElement>()
const editorTextarea = ref<HTMLTextAreaElement>()
function updateViewport() {
  mobileHeight.value = window.visualViewport?.height || window.innerHeight
}
function updateLayout() {
  isMobile.value = mobileQuery.matches
  historyOpen.value = false
  editorOpen.value = false
  collapsed.value = false
  updateViewport()
}
function closeHistory() {
  historyOpen.value = false
}
function dismissHistoryBackdrop(event: MouseEvent) {
  if (!isMobile.value || event.target !== sidebarElement.value) return
  const bounds = sidebarElement.value!.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    closeHistory()
}
function resizeDraft() {
  if (!textarea.value) return
  textarea.value.style.height = ''
  if (isMobile.value) {
    textarea.value.style.height = 'auto'
    textarea.value.style.height = Math.min(textarea.value.scrollHeight, 136) + 'px'
  }
}
function clearEditor() {
  draft.value = ''
  editorTextarea.value?.focus()
}
async function sendFromEditor() {
  if (!canSend.value) return
  editorOpen.value = false
  await send()
}

const searchOpen = ref(false)
const search = ref('')
const filter = ref('all')
const conversations = ref<Conversation[]>([])
const activeId = ref<number | null>(null)
const messages = ref<Message[]>([])
const draft = ref('')
const historyLoading = ref(false)
const error = ref('')
const notice = ref('')
const agent = ref('')
const agents = ref<Agent[]>([])
const models = ref<Model[]>([])
const model = ref('')
const modelWarning = ref('')
const streaming = ref(false)
const stopping = ref(false)
const copied = ref('')
const renameTarget = ref<Conversation | null>(null)
const renameValue = ref('')
const renaming = ref(false)
const deleteTarget = ref<Conversation | null>(null)
const deleting = ref(false)
const deleteError = ref('')
const deleteUncertain = ref(false)
const deleteConfigured = ref(false)
const deleteDialog = ref<HTMLDialogElement>()
const scroller = ref<HTMLElement>()
const textarea = ref<HTMLTextAreaElement>()
const settingsDialog = ref<HTMLDialogElement>()
const renameDialog = ref<HTMLDialogElement>()
const atBottom = ref(true)
type ChatRun = {
  id: number
  controller: AbortController
  answer: Message
  conversationId: number | null
  stopped: boolean
}
let nextRunId = 0
let activeRun: ChatRun | null = null
const pendingStopRuns = new Set<number>()
let historyVersion = 0
let noticeTimer: ReturnType<typeof setTimeout>
const busy = computed(
  () => streaming.value || stopping.value || connecting.value || booting.value || deleting.value,
)
const editorDisabled = computed(
  () =>
    streaming.value || connecting.value || booting.value || deleting.value || historyLoading.value,
)
const currentTitle = computed(
  () => conversations.value.find((c) => c.id === activeId.value)?.title || '新对话',
)
const canSend = computed(
  () =>
    draft.value.trim() &&
    !streaming.value &&
    !connecting.value &&
    !booting.value &&
    !deleting.value &&
    !historyLoading.value &&
    (mode.value === 'demo' || (connected.value && agent.value)),
)
const groups = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const result = [
    { name: '今天', items: [] as Conversation[] },
    { name: '昨天', items: [] as Conversation[] },
    { name: '更早', items: [] as Conversation[] },
  ]
  for (const c of [...conversations.value].sort((a, b) => b.time - a.time)) {
    if (!c.title.toLowerCase().includes(search.value.toLowerCase())) continue
    if (filter.value === 'today' && c.time < today.getTime()) continue
    if (filter.value === 'week' && c.time < Date.now() - 7 * 86400000) continue
    result[c.time >= today.getTime() ? 0 : c.time >= yesterday.getTime() ? 1 : 2]!.items.push(c)
  }
  return result.filter((g) => g.items.length)
})
function toast(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 3800)
}
function readable(e: unknown) {
  return e instanceof Error ? e.message : '操作失败，请重试。'
}
function incompleteStreamMessage(message: string) {
  if (/Rejected concurrent agent run|当前会话已有智能体任务正在运行/i.test(message))
    return '上一轮停止尚未在服务端生效，请稍候后重新发送；当前消息未作为新一轮执行。'
  return `运行出现错误，未收到后续完整结果：${message}`
}
function saveDemo() {
  if (mode.value !== 'demo') return
  const c = conversations.value.find((c) => c.id === activeId.value)
  if (c) c.messages = messages.value
  try {
    localStorage.setItem('luoshan-demo-v1', JSON.stringify(conversations.value.slice(0, 50)))
  } catch {
    toast('浏览器存储不可用，本次演示记录仅在页面中保留。')
  }
}
function enterDemo() {
  if (busy.value && !booting.value) return
  historyVersion++
  mode.value = 'demo'
  connected.value = false
  error.value = ''
  draft.value = ''
  let saved: Conversation[] | null = null
  try {
    const parsed = JSON.parse(localStorage.getItem('luoshan-demo-v1') || 'null')
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (c) =>
          typeof c.id === 'number' &&
          c.id < 0 &&
          typeof c.title === 'string' &&
          typeof c.time === 'number' &&
          Array.isArray(c.messages),
      )
    )
      saved = parsed
  } catch {
    toast('演示记录无法读取，已恢复初始示例。')
  }
  conversations.value = saved || seedConversations()
  activeId.value = isMobile.value ? null : (conversations.value[0]?.id ?? null)
  messages.value = isMobile.value
    ? []
    : JSON.parse(JSON.stringify(conversations.value[0]?.messages || []))
  closeHistory()
  historyLoading.value = false
  settings.value = false
}
async function connect() {
  if (streaming.value || stopping.value || connecting.value) return
  connecting.value = true
  mode.value = 'live'
  connected.value = false
  error.value = ''
  modelWarning.value = ''
  historyVersion++
  conversations.value = []
  messages.value = []
  activeId.value = null
  draft.value = ''
  historyLoading.value = false
  try {
    const config = await api.config()
    configured.value = config.configured
    deleteConfigured.value = config.conversationDeleteConfigured === true
    if (!config.configured) throw new Error('尚未配置北向服务。请填写项目 .env 后重启服务。')
    const [, loadedAgents, list] = await Promise.all([
      api.health(),
      api.agents(),
      api.conversations(),
    ])
    agents.value = loadedAgents
    conversations.value = list
    agent.value = loadedAgents.some((a) => a.name === agent.value)
      ? agent.value
      : loadedAgents.find((a) => a.name === config.agentName)?.name || loadedAgents[0]?.name || ''
    if (!agent.value)
      throw new Error('当前账号没有可用的已发布智能体，请在 Nexent 发布智能体后重试。')
    connected.value = true
    try {
      models.value = await api.models()
    } catch (e) {
      models.value = []
      modelWarning.value = '模型列表不可用，将使用智能体默认模型。' + readable(e)
    }
    model.value = ''
    settings.value = false
    if (list.length && !isMobile.value)
      await selectConversation([...list].sort((a, b) => b.time - a.time)[0]!)
    toast('已连接 Nexent 北向服务')
  } catch (e) {
    error.value = readable(e)
    settings.value = true
  } finally {
    connecting.value = false
  }
}
async function selectConversation(c: Conversation) {
  if (streaming.value || stopping.value) return
  closeHistory()
  const version = ++historyVersion
  if (mode.value === 'demo') saveDemo()
  activeId.value = c.id
  messages.value = []
  error.value = ''
  draft.value = ''
  historyLoading.value = true
  try {
    const loaded =
      mode.value === 'demo' ? JSON.parse(JSON.stringify(c.messages || [])) : await api.history(c.id)
    if (version !== historyVersion) return
    messages.value = loaded
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = 0
  } catch (e) {
    if (version === historyVersion) error.value = readable(e)
  } finally {
    if (version === historyVersion) historyLoading.value = false
  }
}
function toggleSearch() {
  searchOpen.value = !searchOpen.value
  search.value = ''
}
function fillDraft(question: string) {
  draft.value = question
  textarea.value?.focus()
}
function newChat() {
  if (busy.value) return
  closeHistory()
  saveDemo()
  historyVersion++
  historyLoading.value = false
  activeId.value = null
  messages.value = []
  draft.value = ''
  error.value = ''
  if (!isMobile.value) nextTick(() => textarea.value?.focus())
}
async function jumpLatest(smooth = true) {
  await nextTick()
  scroller.value?.scrollTo({
    top: scroller.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  })
  atBottom.value = true
}
function onScroll() {
  const el = scroller.value
  if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100
}
function isActiveRun(run: ChatRun) {
  return activeRun === run
}
function setStopPending(run: ChatRun, pending: boolean) {
  if (pending) pendingStopRuns.add(run.id)
  else pendingStopRuns.delete(run.id)
  stopping.value = pendingStopRuns.size > 0
}
function addConversation(id: number, query: string) {
  activeId.value = id
  if (!conversations.value.some((c) => c.id === id))
    conversations.value.unshift({ id, title: query.slice(0, 28), time: Date.now(), messages: [] })
}
async function send() {
  if (!canSend.value) return
  const query = draft.value.trim()
  const conversationId = activeId.value
  const wasNew = conversationId === null
  draft.value = ''
  if (isMobile.value) textarea.value?.blur()
  error.value = ''
  streaming.value = true
  const answerId = uuid()
  const answerDraft: Message = {
    id: answerId,
    role: 'assistant',
    content: '',
    thinking: '',
    status: '正在思考',
  }
  messages.value.push({ id: uuid(), role: 'user', content: query }, answerDraft)
  // Mutate the reactive array member so each streamed update reaches the template.
  const answer = messages.value.at(-1)!
  const run: ChatRun = {
    id: ++nextRunId,
    controller: new AbortController(),
    answer,
    conversationId,
    stopped: false,
  }
  activeRun = run
  const signal = run.controller.signal
  await jumpLatest()
  let finalSeen = false
  let pendingStreamError = ''
  let timedOut = false
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  try {
    if (mode.value === 'demo') {
      if (wasNew && isActiveRun(run)) {
        const id = -Date.now()
        run.conversationId = id
        addConversation(id, query)
      }
      const text = demoAnswer(query)
      for (let i = 0; i < text.length; i += 9) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        if (!isActiveRun(run)) return
        answer.content += text.slice(i, i + 9)
        answer.status = '正在生成'
        if (atBottom.value) void jumpLatest(false)
        await new Promise((r) => setTimeout(r, 24))
      }
    } else {
      startupTimer = setTimeout(() => {
        if (!isActiveRun(run)) return
        timedOut = true
        run.controller.abort()
        error.value = '连接超时，服务端运行状态未知，请刷新历史确认后再发送。'
      }, 45_000)
      const payload: Record<string, unknown> = {
        agent_name: agent.value,
        query,
        meta_data: { source: 'luoshan-pc-assistant' },
      }
      if (!wasNew) payload.conversation_id = conversationId
      if (model.value) payload.model_id = Number(model.value)
      const finished = await runChat(payload, signal, (event: StreamEvent) => {
        if (!isActiveRun(run)) return
        clearTimeout(startupTimer)
        const item = answer
        if (event.type === 'conversation_created') {
          const id = Number((event.content as { conversation_id?: number })?.conversation_id)
          if (!Number.isInteger(id) || id < 1) throw new Error('服务返回了无效的会话 ID。')
          run.conversationId = id
          addConversation(id, query)
        } else if (recordProcessEvent(item, event)) {
          // Reasoning and tool output are rendered separately from the answer.
        } else if (event.type === 'model_output' && !finalSeen) {
          item.content += eventText(event.content)
          item.status = '正在生成'
        } else if (event.type === 'final_answer') {
          const final = eventText(event.content)
          if (final) {
            item.content = final
            finalSeen = true
            pendingStreamError = ''
          }
        } else if (event.type === 'tool') item.status = '正在调用工具'
        else if (['error', 'agent_error'].includes(event.type)) {
          // Step failures can be followed by recovery. Keep reading until the stream ends.
          pendingStreamError = eventText(event.content) || '智能体运行出错'
          item.streamWarnings ||= []
          item.streamWarnings.push(pendingStreamError)
          item.status = '运行出现提示，等待后续结果'
        }
        if (atBottom.value) void jumpLatest(false)
      })
      if (!isActiveRun(run) || run.stopped) return
      if (pendingStreamError) throw new Error(incompleteStreamMessage(pendingStreamError))
      if (!finished && !finalSeen)
        throw new Error('回复连接提前中断，已保留收到的内容；请查看历史确认结果。')
      if (!answer.content.trim())
        throw new Error('智能体已结束，但没有返回正文。请检查智能体配置。')
      if (wasNew && run.conversationId !== null) {
        try {
          await api.rename(run.conversationId, query.slice(0, 28))
        } catch {
          toast('回复已完成，但标题保存失败，可在左侧重新命名。')
        }
      }
    }
    if (isActiveRun(run) && !run.stopped) answer.status = '已完成'
  } catch (e) {
    if (run.stopped || (signal.aborted && !timedOut)) answer.status = '已停止'
    else if (isActiveRun(run)) {
      answer.error = readable(e)
      answer.status = '生成失败'
      if (!answer.content && !draft.value) draft.value = query
    }
  } finally {
    clearTimeout(startupTimer)
    settleProcessEvents(answer, run.stopped || (signal.aborted && !timedOut))
    if (!isActiveRun(run)) return
    streaming.value = false
    activeRun = null
    const c = conversations.value.find((c) => c.id === run.conversationId)
    if (c) c.time = Date.now()
    saveDemo()
  }
}
function stopLocally(run: ChatRun) {
  run.stopped = true
  run.answer.status = '已停止'
  run.controller.abort()
  settleProcessEvents(run.answer, true)
  if (isActiveRun(run)) {
    activeRun = null
    streaming.value = false
  }
  saveDemo()
}
async function stop() {
  const run = activeRun
  if (!run || run.stopped || pendingStopRuns.has(run.id)) return
  const conversationId = run.conversationId
  // Nexent's own chat UI first stops its browser-side reader. Doing that here
  // makes the composer immediately available and prevents the old run's late
  // callbacks from overwriting a later reply.
  stopLocally(run)
  if (mode.value === 'demo') return
  if (conversationId === null) {
    toast('本轮尚未取得会话 ID，已停止本地接收；无法确认服务端是否停止。')
    return
  }
  setStopPending(run, true)
  try {
    await api.stop(conversationId)
  } catch (e) {
    toast('停止请求未获服务端确认，服务器可能仍在继续生成：' + readable(e))
  } finally {
    setStopPending(run, false)
  }
}
function keydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault()
    void send()
  }
}
async function copyMessage(m: Message) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(m.content)
    } else {
      // 非安全上下文(HTTP)无 clipboard API, 用隐藏 textarea 兜底
      const ta = document.createElement('textarea')
      ta.value = m.content
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    copied.value = m.id
    setTimeout(() => (copied.value = ''), 2000)
  } catch {
    toast('复制失败，请选择回复文本后手动复制。')
  }
}
function beginRename(c: Conversation) {
  renameTarget.value = c
  renameValue.value = c.title
}
function beginDelete(c: Conversation) {
  if (busy.value) return
  deleteTarget.value = c
  deleteError.value = ''
  deleteUncertain.value = false
}
function closeDelete() {
  if (!deleting.value) deleteTarget.value = null
}
async function removeConversation() {
  if (!deleteTarget.value || busy.value || deleteUncertain.value) return
  const target = deleteTarget.value
  deleting.value = true
  deleteError.value = ''
  try {
    const remaining = conversations.value.filter((c) => c.id !== target.id)
    if (mode.value === 'live') {
      if (!deleteConfigured.value) throw new Error('请先连接主 API 后再删除会话。')
      await api.deleteConversation(target.id)
    } else {
      // Persist before removing the row so a storage failure cannot pretend deletion succeeded.
      const current = remaining.find((c) => c.id === activeId.value)
      if (current) current.messages = messages.value
      localStorage.setItem('luoshan-demo-v1', JSON.stringify(remaining))
    }
    conversations.value = remaining
    if (activeId.value === target.id) {
      historyVersion++
      activeId.value = null
      messages.value = []
      draft.value = ''
      historyLoading.value = false
      error.value = ''
    }
    deleteTarget.value = null
    toast(mode.value === 'demo' ? '演示对话已删除' : '对话已删除')
  } catch (e) {
    deleteError.value = readable(e)
    deleteUncertain.value = mode.value === 'live'
  } finally {
    deleting.value = false
  }
}
async function rename() {
  if (!renameTarget.value || !renameValue.value.trim() || renaming.value) return
  renaming.value = true
  try {
    const title = renameValue.value.trim()
    if (mode.value === 'live') await api.rename(renameTarget.value.id, title)
    renameTarget.value.title = title
    saveDemo()
    renameTarget.value = null
    toast('对话已重命名')
  } catch (e) {
    error.value = readable(e)
  } finally {
    renaming.value = false
  }
}
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    if (!streaming.value) onScroll()
  },
)
watch([booting, historyLoading], async () => {
  await nextTick()
  if (!streaming.value) onScroll()
})
let resizeObserver: ResizeObserver | undefined
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  mobileQuery.removeEventListener('change', updateLayout)
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.removeEventListener('resize', updateViewport)
  clearTimeout(noticeTimer)
  activeRun?.controller.abort()
})
watch(settings, async (open) => {
  await nextTick()
  if (open) settingsDialog.value?.showModal()
  else settingsDialog.value?.close()
})
watch(renameTarget, async (target) => {
  await nextTick()
  if (target) renameDialog.value?.showModal()
  else renameDialog.value?.close()
})
watch(deleteTarget, async (target) => {
  await nextTick()
  if (target) deleteDialog.value?.showModal()
  else deleteDialog.value?.close()
})
watch([draft, isMobile], async () => {
  await nextTick()
  resizeDraft()
})
watch(historyOpen, async (open) => {
  await nextTick()
  if (!(sidebarElement.value instanceof HTMLDialogElement)) return
  if (open) sidebarElement.value.showModal()
  else sidebarElement.value.close()
})
watch(editorOpen, async (open) => {
  await nextTick()
  if (open) {
    editorDialog.value?.showModal()
    editorTextarea.value?.focus()
  } else editorDialog.value?.close()
})
onMounted(async () => {
  mobileQuery.addEventListener('change', updateLayout)
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.addEventListener('resize', updateViewport)
  resizeDraft()
  resizeObserver = new ResizeObserver(() => {
    if (!streaming.value) onScroll()
  })
  if (scroller.value) resizeObserver.observe(scroller.value)
  try {
    const config = await api.config()
    configured.value = config.configured
    agent.value = config.agentName
    if (config.configured) await connect()
    else enterDemo()
  } catch (e) {
    mode.value = 'live'
    error.value = '无法读取应用配置：' + readable(e)
  } finally {
    booting.value = false
  }
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ collapsed: !isMobile && collapsed, 'mobile-shell': isMobile }"
    :style="isMobile ? { '--mobile-height': `${mobileHeight}px` } : undefined"
  >
    <header v-if="isMobile" class="mobile-topbar">
      <div class="mobile-nav-actions">
        <button
          class="mobile-icon-button"
          aria-label="打开历史对话"
          aria-haspopup="dialog"
          :aria-expanded="historyOpen"
          @click="historyOpen = true"
        >
          <Menu :size="25" />
        </button>
        <button
          class="mobile-icon-button"
          aria-label="返回助手首页"
          :disabled="busy"
          @click="newChat"
        >
          <Home :size="25" />
        </button>
      </div>
      <div class="mobile-heading">
        <strong>AI智能助手</strong>
        <span :class="{ 'is-connected': connected }">
          {{
            booting
              ? '正在连接…'
              : mode === 'demo'
                ? '演示模式'
                : connected
                  ? '已连接 Nexent'
                  : '未连接'
          }}
        </span>
      </div>
      <button
        class="mobile-icon-button mobile-settings"
        aria-label="连接设置"
        :disabled="streaming || stopping"
        @click="settings = true"
      >
        <Ellipsis :size="27" />
      </button>
    </header>
    <header v-else class="topbar">
      <a class="brand" href="/" aria-label="罗山科技园 AI 智能助手">
        <svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path
            d="M21 3 37 19 31 25 15 9 21 3ZM9 15 25 31 19 37 3 21 9 15Z"
            stroke="currentColor"
            stroke-width="3"
          />
          <path d="m25 10-9 9 9 9M15 30l9-9-9-9" stroke="currentColor" stroke-width="3" />
        </svg>
        <span>罗山科技园</span>
      </a>
      <nav aria-label="园区主导航" class="navigation">
        <button disabled title="首页由园区门户提供">
          <Home :size="18" />
          首页
        </button>
        <button class="nav-active" aria-current="page">
          <Bot :size="19" />
          AI智能
        </button>
        <button disabled title="数据统计由园区门户提供">
          <ChartPie :size="18" />
          数据统计
        </button>
        <button disabled title="培训系统由园区门户提供">
          <BookMarked :size="18" />
          培训系统
        </button>
        <button disabled title="通讯录由园区门户提供">
          <ContactRound :size="18" />
          通讯录
        </button>
      </nav>
      <div class="header-actions">
        <button
          class="icon-button"
          aria-label="通知"
          @click="infoPanel = infoPanel === 'notifications' ? null : 'notifications'"
        >
          <Bell :size="19" />
          <span class="notification-dot"></span>
        </button>
        <span class="header-divider"></span>
        <button
          class="avatar"
          aria-label="用户信息"
          @click="infoPanel = infoPanel === 'profile' ? null : 'profile'"
        >
          <UserRound :size="20" />
        </button>
      </div>
      <div v-if="infoPanel" class="header-popover">
        <strong>{{ infoPanel === 'notifications' ? '通知中心' : '园区 AI 助手' }}</strong>
        <p>
          {{
            infoPanel === 'notifications'
              ? '当前没有新通知。此独立页面尚未接入园区通知服务。'
              : mode === 'demo'
                ? '您正在使用本地演示。连接服务后，访问权限由 API Key 对应的用户与租户决定。'
                : '当前以服务端 API Key 对应的用户身份访问 Nexent。'
          }}
        </p>
        <button @click="infoPanel = null">知道了</button>
      </div>
    </header>

    <div class="workspace">
      <component
        :is="isMobile ? 'dialog' : 'aside'"
        ref="sidebarElement"
        class="sidebar"
        aria-label="历史对话"
        @cancel="closeHistory"
        @close="closeHistory"
        @click="dismissHistoryBackdrop"
      >
        <div v-if="isMobile" class="mobile-drawer-heading">
          <span>历史对话</span>
          <button class="mobile-icon-button" aria-label="关闭历史对话" @click="closeHistory">
            <X :size="22" />
          </button>
        </div>
        <div class="sidebar-top">
          <button class="new-chat" :disabled="busy" @click="newChat">
            <MessageSquarePlus :size="20" />
            <span>新建对话</span>
          </button>
          <button
            class="search-button"
            :class="{ selected: searchOpen }"
            aria-label="搜索对话"
            @click="toggleSearch"
          >
            <Search :size="21" />
          </button>
        </div>
        <div v-if="searchOpen" class="search-field">
          <Search :size="16" />
          <input v-model="search" aria-label="搜索历史对话" placeholder="搜索历史对话" autofocus />
          <button v-if="search" class="icon-button" aria-label="清空搜索" @click="search = ''">
            <X :size="14" />
          </button>
        </div>
        <button class="schedule-entry" aria-label="定时任务" @click="openTasks">
          <CalendarClock :size="18" />
          <span>定时任务</span>
          <small>提案确认</small>
        </button>
        <div class="filter-select">
          <select v-model="filter" aria-label="按时间筛选">
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">最近 7 天</option>
          </select>
          <ChevronDown :size="16" />
        </div>
        <div class="conversation-list">
          <div v-if="booting || connecting" class="list-empty">
            <LoaderCircle class="spin" :size="20" />
            正在加载会话
          </div>
          <section v-for="group in groups" :key="group.name" class="history-group">
            <h2>
              {{ group.name }}
              <span>{{ group.items.length }}</span>
            </h2>
            <div
              v-for="c in group.items"
              :key="c.id"
              class="conversation"
              :class="{ active: c.id === activeId }"
            >
              <button
                class="conversation-title"
                :disabled="busy"
                :title="c.title"
                :aria-current="c.id === activeId ? 'true' : undefined"
                @click="selectConversation(c)"
              >
                {{ c.title }}
              </button>
              <button
                class="conversation-menu"
                :disabled="busy"
                :aria-label="`重命名 ${c.title}`"
                title="重命名对话"
                @click="beginRename(c)"
              >
                <Ellipsis :size="19" />
              </button>
              <button
                class="conversation-menu conversation-delete"
                :disabled="busy || (mode === 'live' && !deleteConfigured)"
                :aria-label="`删除 ${c.title}`"
                :title="
                  mode === 'live' && !deleteConfigured
                    ? '请先配置主 API 连接以删除会话'
                    : '删除对话'
                "
                @click="beginDelete(c)"
              >
                <Trash2 :size="15" />
              </button>
            </div>
          </section>
          <div v-if="!groups.length && !booting && !connecting" class="list-empty">
            <Search :size="23" />
            <span>{{ search ? '没有找到相关对话' : '暂无历史对话' }}</span>
            <small>{{ search ? '试试其他关键词' : '从新建对话开始吧' }}</small>
          </div>
        </div>
        <div v-if="!isMobile" class="sidebar-bottom">
          <button :disabled="busy" @click="newChat">
            <ArrowLeft :size="18" />
            <span>返回</span>
          </button>
          <button aria-label="收起侧栏" title="收起侧栏" @click="collapsed = true">
            <PanelLeftClose :size="18" />
          </button>
        </div>
        <div v-if="isMobile" class="mobile-drawer-footer">
          <AssistantEmblem />
          <div>
            <strong>罗山 AI 助手</strong>
            <span>{{ mode === 'demo' ? '演示模式 · 本地会话' : '园区服务 · 智能问答' }}</span>
          </div>
        </div>
      </component>

      <main class="chat-panel">
        <div v-if="!isMobile" class="chat-toolbar">
          <div class="toolbar-left">
            <button
              v-if="collapsed"
              class="icon-button"
              aria-label="展开侧栏"
              @click="collapsed = false"
            >
              <PanelLeftOpen :size="19" />
            </button>
            <button
              v-if="collapsed"
              class="icon-button"
              aria-label="定时任务"
              title="定时任务"
              @click="openTasks"
            >
              <CalendarClock :size="19" />
            </button>
            <Bot :size="17" class="assistant-icon" />
            <span>园区智能助手</span>
            <span class="toolbar-slash">/</span>
            <span class="toolbar-title">{{ currentTitle }}</span>
          </div>
          <button
            class="connection-button"
            :disabled="streaming || stopping"
            aria-label="连接设置"
            @click="settings = true"
          >
            <span class="status-dot" :class="{ live: connected }"></span>
            {{
              booting
                ? '加载中'
                : mode === 'demo'
                  ? '演示模式'
                  : connected
                    ? '已连接 Nexent'
                    : '未连接'
            }}
            <Settings2 :size="15" />
          </button>
        </div>
        <div class="message-region">
          <div ref="scroller" class="message-scroll" @scroll="onScroll">
            <div v-if="historyLoading || booting" class="loading-state">
              <LoaderCircle class="spin" :size="26" />
              <span>正在加载对话…</span>
            </div>
            <div v-else-if="!messages.length" class="welcome-state">
              <AssistantEmblem v-if="isMobile" class="welcome-emblem" />
              <div v-else class="welcome-icon"><Bot :size="35" /></div>
              <div class="welcome-eyebrow">LUOSHAN · AI ASSISTANT</div>
              <h1>{{ isMobile ? '我是您的AI智能助手' : '您好，有什么可以帮您？' }}</h1>
              <p>
                {{
                  isMobile
                    ? '欢迎向我提问，我会努力为您解答！'
                    : '数据分析、预测预警、巡检上报与运维报告，随时为您处理。'
                }}
              </p>
              <span class="welcome-note">
                {{
                  mode === 'demo'
                    ? '当前为演示模式，连接服务后即可获取智能体回答。'
                    : '回答由 Nexent 智能体生成，请核实重要信息。'
                }}
              </span>
            </div>
            <div v-else class="messages">
              <article v-for="m in messages" :key="m.id" class="message" :class="m.role">
                <template v-if="m.role === 'user'">
                  <div class="user-bubble">
                    {{ m.content }}
                    <div v-if="m.attachments?.length" class="sent-files">
                      <span v-for="f in m.attachments" :key="f.name">
                        <Paperclip :size="14" />
                        {{ f.name }}
                      </span>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <MessageProcess
                    :message="m"
                    :running="streaming && m.id === messages.at(-1)?.id"
                  />
                  <MarkdownMessage v-if="m.content" :content="m.content" />
                  <details v-if="m.streamWarnings?.length" class="thinking stream-warnings">
                    <summary>
                      <CircleHelp :size="14" />
                      运行过程提示（{{ m.streamWarnings.length }}）
                      <ChevronDown :size="14" />
                    </summary>
                    <p v-for="(warning, index) in m.streamWarnings" :key="index">{{ warning }}</p>
                  </details>
                  <div v-if="streaming && m.id === messages.at(-1)?.id" class="generating">
                    <span class="pulse-dot"></span>
                    {{ m.status }}
                    <span class="thinking-dots">···</span>
                  </div>
                  <div v-if="m.error" class="message-error" role="alert">
                    <CircleHelp :size="16" />
                    {{ m.error }}
                  </div>
                  <div
                    class="message-footer"
                    v-if="m.content && !(streaming && m.id === messages.at(-1)?.id)"
                  >
                    <button
                      :aria-label="copied === m.id ? '已复制' : '复制回复'"
                      :title="copied === m.id ? '已复制' : '复制回复'"
                      @click="copyMessage(m)"
                    >
                      <Check v-if="copied === m.id" :size="16" />
                      <Copy v-else :size="16" />
                    </button>
                    <span>
                      {{
                        m.status === '已停止'
                          ? '已停止生成'
                          : mode === 'demo'
                            ? '示例内容 · 仅供体验'
                            : '内容由 AI 生成，请核实重要信息'
                      }}
                    </span>
                  </div>
                </template>
              </article>
            </div>
          </div>
          <button v-if="messages.length && !atBottom" class="jump-latest" @click="jumpLatest()">
            <ArrowDown :size="16" />
            定位最新
          </button>
        </div>

        <div class="composer-area">
          <div v-if="error" class="error-banner" role="alert">
            <CircleHelp :size="17" />
            <span>{{ error }}</span>
            <button v-if="!connected && mode === 'live'" :disabled="busy" @click="connect">
              重试连接
            </button>
            <button class="icon-button" aria-label="关闭错误提示" @click="error = ''">
              <X :size="16" />
            </button>
          </div>
          <CanDoList :disabled="busy" @select="fillDraft" />
          <form
            class="composer"
            :class="{ 'is-streaming': streaming, 'has-draft': draft.length > 0 }"
            @submit.prevent="send"
          >
            <button
              v-if="isMobile"
              class="expand-draft mobile-icon-button"
              type="button"
              aria-label="展开输入框"
              :disabled="editorDisabled"
              @click="editorOpen = true"
            >
              <Maximize2 :size="19" />
            </button>
            <textarea
              ref="textarea"
              v-model="draft"
              aria-label="向AI提问"
              :placeholder="
                isMobile ? '发消息，向我提问…' : '向AI提问，Shift + Enter换行，Enter发送…'
              "
              :enterkeyhint="isMobile ? 'send' : undefined"
              :disabled="editorDisabled"
              :rows="isMobile ? 1 : 3"
              @keydown="keydown"
            ></textarea>
            <div class="composer-controls">
              <button
                v-if="mode === 'demo' && !isMobile"
                class="schedule-draft"
                type="button"
                :disabled="busy"
                @click="openTasks"
              >
                <CalendarClock :size="15" />
                定时任务
              </button>
              <span v-if="streaming || stopping" class="stream-label">
                {{ streaming ? '正在为您生成回答' : '正在确认停止…' }}
              </span>
              <span v-else-if="mode === 'live' && agent" class="selected-agent">
                <Bot :size="13" />
                {{ agent }}
              </span>
              <button
                v-if="streaming"
                class="send-button stop-button"
                type="button"
                aria-label="停止生成"
                @click="stop"
              >
                <Square :size="16" fill="currentColor" />
              </button>
              <button
                v-else
                class="send-button"
                type="submit"
                :disabled="!canSend"
                aria-label="发送消息"
              >
                <Send :size="20" fill="currentColor" />
              </button>
            </div>
          </form>
          <div class="composer-footnote">
            <span>
              {{
                mode === 'demo'
                  ? '演示模式 · 内容为本地示例，未调用真实服务'
                  : 'Nexent 智能体提供支持 · 请核实回答中的重要信息'
              }}
            </span>
            <span class="keyboard-hint">Enter 发送</span>
          </div>
        </div>
      </main>
    </div>
    <div v-if="notice" role="status" class="toast">
      <Check :size="16" />
      {{ notice }}
    </div>

    <ScheduledTasks :open="tasksOpen" :initial-prompt="draft" @close="tasksOpen = false" />
    <dialog
      ref="editorDialog"
      class="mobile-editor"
      aria-label="展开输入"
      @cancel="editorOpen = false"
      @close="editorOpen = false"
    >
      <form @submit.prevent="sendFromEditor">
        <div class="editor-heading">
          <button type="button" class="clear-draft" :disabled="!draft" @click="clearEditor">
            清空
          </button>
          <span>编辑问题</span>
          <button
            type="button"
            class="mobile-icon-button"
            aria-label="收起输入框"
            @click="editorOpen = false"
          >
            <Minimize2 :size="21" />
          </button>
        </div>
        <textarea
          ref="editorTextarea"
          v-model="draft"
          aria-label="编辑完整问题"
          placeholder="请输入您的问题…"
          @keydown.ctrl.enter.prevent="sendFromEditor"
          @keydown.meta.enter.prevent="sendFromEditor"
        ></textarea>
        <div class="editor-footer">
          <span>收起后仍会保留已输入的内容</span>
          <button class="send-button" aria-label="发送完整问题" :disabled="!canSend">
            <Send :size="22" fill="currentColor" />
          </button>
        </div>
      </form>
    </dialog>
    <dialog
      ref="settingsDialog"
      class="settings-dialog"
      @cancel="settings = false"
      @close="settings = false"
    >
      <div class="dialog-heading">
        <div class="dialog-symbol"><Plug :size="23" /></div>
        <div>
          <h2>连接设置</h2>
          <p>连接您的 Nexent 园区智能体</p>
        </div>
        <button class="icon-button" aria-label="关闭连接设置" @click="settings = false">
          <X :size="21" />
        </button>
      </div>
      <div class="connection-summary">
        <span class="status-dot" :class="{ live: connected }"></span>
        <strong>
          {{
            connected ? '北向服务已连接' : configured ? '服务已配置，等待连接' : '尚未配置北向服务'
          }}
        </strong>
        <span>Nexent 2.5.1</span>
      </div>
      <template v-if="!configured">
        <p class="setup-copy">
          在项目根目录复制
          <code>.env.example</code>
          为
          <code>.env</code>
          ，填写服务地址、API Key 和已发布的 Agent 名称，然后重启应用。
        </p>
        <pre class="env-example">
NEXENT_BASE_URL=http://您的服务地址:30013
NEXENT_API_KEY=您的 access_key
NEXENT_AGENT_NAME=已发布的智能体名称</pre>
        <p class="settings-note">
          <CircleHelp :size="15" />
          API Key 仅由本地服务读取，不写入浏览器或前端代码。
        </p>
      </template>
      <template v-else>
        <label class="form-label">
          已发布的智能体
          <select v-model="agent" :disabled="!agents.length">
            <option v-if="!agents.length" value="">连接后自动获取</option>
            <option v-for="a in agents" :key="a.name" :value="a.name">
              {{ a.display_name || a.name }}
            </option>
          </select>
        </label>
        <label class="form-label">
          对话模型
          <select v-model="model">
            <option value="">使用智能体默认模型</option>
            <option v-for="m in models" :key="m.id" :value="String(m.id)">{{ m.name }}</option>
          </select>
        </label>
        <p v-if="modelWarning" class="settings-note">{{ modelWarning }}</p>
      </template>
      <p v-if="error" role="alert" class="dialog-error">{{ error }}</p>
      <div class="settings-capabilities">
        <span>
          <Check :size="14" />
          流式对话
        </span>
        <span>
          <Check :size="14" />
          历史会话
        </span>
        <span>
          <Check :size="14" />
          多轮问答
        </span>
      </div>
      <div class="dialog-actions">
        <button class="secondary-button" :disabled="connecting" @click="enterDemo">体验演示</button>
        <button class="primary-button" :disabled="connecting" @click="connect">
          <RefreshCw :size="15" :class="{ spin: connecting }" />
          {{ connecting ? '正在连接…' : connected ? '重新连接' : '连接服务' }}
        </button>
        <button v-if="connected" class="primary-button" @click="settings = false">完成</button>
      </div>
    </dialog>
    <dialog
      ref="deleteDialog"
      class="rename-dialog delete-dialog"
      aria-labelledby="delete-heading"
      @cancel.prevent="closeDelete"
      @close="closeDelete"
    >
      <div class="dialog-heading">
        <Trash2 :size="21" />
        <h2 id="delete-heading">删除对话</h2>
      </div>
      <p class="delete-title">确定删除「{{ deleteTarget?.title }}」？</p>
      <p class="delete-warning">
        {{
          mode === 'demo'
            ? '仅删除当前浏览器中的演示记录，不影响 Nexent 服务端数据。'
            : '此操作将删除该会话及其消息记录。若绑定了定时任务，关联任务也会被删除，相关执行会被取消。页面不提供恢复功能。'
        }}
      </p>
      <p v-if="deleteError" class="dialog-error" role="alert">{{ deleteError }}</p>
      <p v-if="deleteUncertain" class="delete-warning">
        未自动重试。请关闭弹窗并刷新历史和任务列表，核实结果后再操作。
      </p>
      <div class="dialog-actions">
        <button class="secondary-button" :disabled="deleting" autofocus @click="closeDelete">
          {{ deleteUncertain ? '关闭' : '取消' }}
        </button>
        <button
          class="primary-button danger-button"
          :disabled="deleting || deleteUncertain"
          @click="removeConversation"
        >
          {{ deleting ? '正在删除…' : '确认删除' }}
        </button>
      </div>
    </dialog>
    <dialog
      ref="renameDialog"
      class="rename-dialog"
      @cancel="renameTarget = null"
      @close="renameTarget = null"
    >
      <form @submit.prevent="rename">
        <div class="dialog-heading">
          <Pencil :size="21" />
          <h2>重命名对话</h2>
          <button
            class="icon-button"
            type="button"
            aria-label="取消重命名"
            @click="renameTarget = null"
          >
            <X :size="20" />
          </button>
        </div>
        <label class="form-label">
          对话名称
          <input v-model="renameValue" maxlength="100" autofocus required aria-label="对话名称" />
        </label>
        <p v-if="error" class="dialog-error">{{ error }}</p>
        <div class="dialog-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="renaming"
            @click="renameTarget = null"
          >
            取消
          </button>
          <button class="primary-button" :disabled="!renameValue.trim() || renaming">
            {{ renaming ? '保存中…' : '保存名称' }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style>
.conversation-delete:hover {
  color: #b55543;
}
.delete-title {
  overflow-wrap: anywhere;
  line-height: 1.7;
  color: #344e63;
}
.delete-warning {
  font-size: 13px;
  line-height: 1.8;
  color: #8d7365;
}
.delete-dialog .dialog-actions .primary-button.danger-button {
  background: #b95847;
  border-color: #b95847;
}
.delete-dialog .dialog-actions .primary-button.danger-button:hover {
  background: #a54a3b;
}
.schedule-entry {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-start;
  min-height: 42px;
  padding: 10px 12px;
  margin-top: 12px;
  border: 1px solid #dcebf5;
  border-radius: 8px;
  color: #4f849f;
  background: #f5fbff;
  font-size: 13px;
}
.schedule-entry small {
  margin-left: auto;
  color: #98a9b8;
  font-size: 10px;
}
.schedule-entry:hover {
  background: #e7f5ff;
}
.schedule-draft {
  font-size: 12px;
  color: #7791a4;
  padding: 5px 8px;
  border-radius: 6px;
}
.schedule-draft:hover {
  background: #f0f8fd;
  color: #007fbe;
}
.mobile-shell .schedule-entry {
  font-size: 15px;
  min-height: 46px;
}
</style>
