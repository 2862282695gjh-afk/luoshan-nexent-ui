<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Square,
  Wifi,
  WifiOff,
  X,
} from 'lucide-vue-next'
import AssistantEmblem from './components/AssistantEmblem.vue'
import CanDoList from './components/CanDoList.vue'
import MarkdownMessage from './components/MarkdownMessage.vue'
import MessageProcess from './components/MessageProcess.vue'
import { api, eventText, runChat } from './api'
import { recordProcessEvent, settleProcessEvents } from './process-events'
import type { Agent, Message, StreamEvent } from './types'
import { uuid } from './uuid'

const showChrome = new URLSearchParams(window.location.search).get('chrome') !== '0'
const booting = ref(true)
const connected = ref(false)
const connecting = ref(false)
const connectionError = ref('')
const messages = ref<Message[]>([])
const draft = ref('')
const agent = ref('')
const agentLabel = ref('')
const conversationId = ref<number | null>(null)
const streaming = ref(false)
const stopping = ref(false)
const copied = ref('')
const scroller = ref<HTMLElement>()
const textarea = ref<HTMLTextAreaElement>()
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

const canSend = computed(
  () =>
    draft.value.trim() &&
    connected.value &&
    !connecting.value &&
    !booting.value &&
    !streaming.value,
)
const agentDescription = computed(() => agentLabel.value || agent.value || '智能助手')

function readable(error: unknown) {
  return error instanceof Error ? error.message : '连接失败，请稍后重试。'
}

function incompleteStreamMessage(message: string) {
  if (/Rejected concurrent agent run|当前会话已有智能体任务正在运行/i.test(message))
    return '上一轮停止尚未在服务端生效，请稍候后重新发送；当前消息未作为新一轮执行。'
  return `运行出现错误，未收到后续完整结果：${message}`
}

function selectDefaultAgent(agents: Agent[], configuredAgent: string) {
  const selected = agents.find((item) => item.name === configuredAgent) || agents[0]
  if (!selected) throw new Error('当前账号没有可用的已发布智能体，请在 Nexent 发布智能体后重试。')
  agent.value = selected.name
  agentLabel.value = selected.display_name || selected.name
}

async function connect() {
  if (connecting.value || streaming.value) return
  connecting.value = true
  connected.value = false
  connectionError.value = ''
  try {
    const config = await api.config()
    if (!config.configured) throw new Error('助手服务尚未完成北向配置。')
    const [, agents] = await Promise.all([api.health(), api.agents()])
    selectDefaultAgent(agents, config.agentName)
    connected.value = true
  } catch (error) {
    connectionError.value = readable(error)
  } finally {
    connecting.value = false
  }
}

function newConversation() {
  if (streaming.value) return
  messages.value = []
  conversationId.value = null
  draft.value = ''
  connectionError.value = ''
  void nextTick(() => textarea.value?.focus())
}

async function scrollLatest(smooth = true) {
  await nextTick()
  scroller.value?.scrollTo({
    top: scroller.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  })
  atBottom.value = true
}

function onScroll() {
  const element = scroller.value
  if (element) atBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 88
}

function isActiveRun(run: ChatRun) {
  return activeRun === run
}

function setStopPending(run: ChatRun, pending: boolean) {
  if (pending) pendingStopRuns.add(run.id)
  else pendingStopRuns.delete(run.id)
  stopping.value = pendingStopRuns.size > 0
}

function resizeDraft() {
  const input = textarea.value
  if (!input) return
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`
}

function fillDraft(prompt: string) {
  draft.value = prompt
  void nextTick(() => textarea.value?.focus())
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    void send()
  }
}

async function send() {
  if (!canSend.value) return
  const query = draft.value.trim()
  const initialConversationId = conversationId.value
  const isNewConversation = initialConversationId === null
  draft.value = ''
  connectionError.value = ''
  streaming.value = true
  const answerDraft: Message = {
    id: uuid(),
    role: 'assistant',
    content: '',
    thinking: '',
    status: '正在思考',
  }
  messages.value.push({ id: uuid(), role: 'user', content: query }, answerDraft)
  // Keep the reactive item from the array so SSE updates refresh the view immediately.
  const answer = messages.value.at(-1)!
  const run: ChatRun = {
    id: ++nextRunId,
    controller: new AbortController(),
    answer,
    conversationId: initialConversationId,
    stopped: false,
  }
  activeRun = run
  const signal = run.controller.signal
  await scrollLatest()
  let finalSeen = false
  let pendingStreamError = ''
  let timedOut = false
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  try {
    startupTimer = setTimeout(() => {
      if (!isActiveRun(run)) return
      timedOut = true
      run.controller.abort()
      connectionError.value = '连接超时，服务端运行状态未知，请稍后刷新或新建对话。'
    }, 45_000)
    const payload: Record<string, unknown> = {
      agent_name: agent.value,
      query,
      meta_data: { source: 'luoshan-portal-widget' },
    }
    if (!isNewConversation) payload.conversation_id = initialConversationId
    const finished = await runChat(payload, signal, (event: StreamEvent) => {
      if (!isActiveRun(run)) return
      clearTimeout(startupTimer)
      const item = answer
      if (event.type === 'conversation_created') {
        const id = Number((event.content as { conversation_id?: number })?.conversation_id)
        if (!Number.isInteger(id) || id < 1) throw new Error('服务返回了无效的会话 ID。')
        run.conversationId = id
        conversationId.value = id
      } else if (recordProcessEvent(item, event)) {
        // Reasoning and tool events render in their own expandable areas.
      } else if (event.type === 'model_output' && !finalSeen) {
        item.content += eventText(event.content)
        item.status = '正在生成'
      } else if (event.type === 'final_answer') {
        const finalAnswer = eventText(event.content)
        if (finalAnswer) {
          item.content = finalAnswer
          finalSeen = true
          pendingStreamError = ''
        }
      } else if (['error', 'agent_error'].includes(event.type)) {
        // A tool or model step may recover and still produce final_answer.
        pendingStreamError = eventText(event.content) || '智能体运行出错'
        item.streamWarnings ||= []
        item.streamWarnings.push(pendingStreamError)
        item.status = '运行出现提示，等待后续结果'
      }
      if (atBottom.value) void scrollLatest(false)
    })
    if (!isActiveRun(run) || run.stopped) return
    if (pendingStreamError) throw new Error(incompleteStreamMessage(pendingStreamError))
    if (!finished && !finalSeen)
      throw new Error('回复连接提前中断，已保留收到的内容；请稍后继续对话。')
    if (!answer.content.trim()) throw new Error('智能体已结束，但没有返回正文。请检查智能体配置。')
    answer.status = '已完成'
  } catch (error) {
    if (run.stopped || (signal.aborted && !timedOut)) answer.status = '已停止'
    else if (isActiveRun(run)) {
      answer.error = readable(error)
      answer.status = '生成失败'
      if (!answer.content && !draft.value) draft.value = query
    }
  } finally {
    clearTimeout(startupTimer)
    settleProcessEvents(answer, run.stopped || (signal.aborted && !timedOut))
    if (!isActiveRun(run)) return
    streaming.value = false
    activeRun = null
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
}

async function stop() {
  const run = activeRun
  if (!run || run.stopped || pendingStopRuns.has(run.id)) return
  const id = run.conversationId
  stopLocally(run)
  if (id === null) {
    connectionError.value = '本轮尚未取得会话 ID，已停止本地接收；无法确认服务端是否停止。'
    return
  }
  setStopPending(run, true)
  try {
    await api.stop(id)
  } catch (error) {
    connectionError.value = '停止请求未获服务端确认，服务器可能仍在继续生成：' + readable(error)
  } finally {
    setStopPending(run, false)
  }
}

async function copyMessage(message: Message) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message.content)
    else {
      const copyInput = document.createElement('textarea')
      copyInput.value = message.content
      document.body.appendChild(copyInput)
      copyInput.select()
      document.execCommand('copy')
      copyInput.remove()
    }
    copied.value = message.id
    window.setTimeout(() => (copied.value = ''), 1800)
  } catch {
    connectionError.value = '复制失败，请选择回答文本后手动复制。'
  }
}

watch(draft, () => void nextTick(resizeDraft))
watch(
  () => messages.value.length,
  () => void nextTick(() => atBottom.value && void scrollLatest(false)),
)
onMounted(async () => {
  await connect()
  booting.value = false
  void nextTick(resizeDraft)
})
onBeforeUnmount(() => activeRun?.controller.abort())
</script>

<template>
  <main class="embed-shell" :class="{ 'embed-with-chrome': showChrome }">
    <header v-if="showChrome" class="embed-topbar">
      <div class="embed-brand">
        <AssistantEmblem />
        <div>
          <strong>罗山智能助手</strong>
          <span>{{ connected ? agentDescription : '北向服务连接' }}</span>
        </div>
      </div>
      <button class="embed-new-chat" type="button" :disabled="streaming" @click="newConversation">
        <MessageSquarePlus :size="16" />
        新对话
      </button>
    </header>

    <section class="embed-chat">
      <div class="embed-context-row">
        <span class="embed-connection" :class="{ online: connected }">
          <Wifi v-if="connected" :size="14" />
          <WifiOff v-else :size="14" />
          {{ booting || connecting ? '正在连接' : connected ? '已连接服务' : '服务未连接' }}
        </span>
        <span v-if="connected" class="embed-agent-name">{{ agentDescription }}</span>
        <button
          v-if="messages.length"
          class="embed-reset"
          type="button"
          :disabled="streaming"
          aria-label="新建嵌入式对话"
          @click="newConversation"
        >
          <RefreshCw :size="15" />
          新对话
        </button>
      </div>

      <div ref="scroller" class="embed-scroll" @scroll="onScroll">
        <div v-if="booting || connecting" class="embed-loading">
          <LoaderCircle :size="22" class="embed-spin" />
          正在连接智能助手…
        </div>
        <div v-else-if="!messages.length" class="embed-welcome">
          <div class="embed-welcome-orb"><Bot :size="28" /></div>
          <p class="embed-kicker">LUOSHAN · AI ASSISTANT</p>
          <h1>{{ connected ? '您好，有什么可以帮您？' : '助手服务暂不可用' }}</h1>
          <p>
            {{
              connected
                ? '可协助处理园区运维问答、数据分析和告警研判。'
                : '请检查服务配置或稍后重新连接。'
            }}
          </p>
          <button v-if="!connected" class="embed-retry" type="button" @click="connect">
            <RefreshCw :size="15" />
            重新连接
          </button>
        </div>

        <div v-else class="embed-messages">
          <article
            v-for="message in messages"
            :key="message.id"
            class="embed-message"
            :class="message.role"
          >
            <div v-if="message.role === 'user'" class="embed-user-bubble">
              {{ message.content }}
            </div>
            <template v-else>
              <div class="embed-assistant-label">
                <Bot :size="15" />
                罗山智能助手
              </div>
              <MessageProcess
                :message="message"
                :running="streaming && message.id === messages.at(-1)?.id"
              />
              <MarkdownMessage v-if="message.content" :content="message.content" />
              <details v-if="message.streamWarnings?.length" class="embed-warnings">
                <summary>
                  <CircleAlert :size="14" />
                  运行过程提示（{{ message.streamWarnings.length }}）
                  <ChevronDown :size="14" />
                </summary>
                <p v-for="(warning, index) in message.streamWarnings" :key="index">{{ warning }}</p>
              </details>
              <div v-if="streaming && message.id === messages.at(-1)?.id" class="embed-generating">
                <span></span>
                {{ message.status }}
              </div>
              <div v-if="message.error" class="embed-message-error" role="alert">
                <CircleAlert :size="15" />
                {{ message.error }}
              </div>
              <div
                v-if="message.status === '已停止' && !message.content"
                class="embed-message-footer"
              >
                <Square :size="12" />
                <span>已停止生成</span>
              </div>
              <div
                v-if="message.content && !(streaming && message.id === messages.at(-1)?.id)"
                class="embed-message-footer"
              >
                <button
                  type="button"
                  :aria-label="copied === message.id ? '已复制' : '复制回复'"
                  @click="copyMessage(message)"
                >
                  <Check v-if="copied === message.id" :size="15" />
                  <Copy v-else :size="15" />
                </button>
                <span>
                  {{
                    message.status === '已停止' ? '已停止生成' : '内容由 AI 生成，请核实重要信息'
                  }}
                </span>
              </div>
            </template>
          </article>
        </div>
      </div>

      <div v-if="connectionError" class="embed-error" role="alert">
        <CircleAlert :size="16" />
        <span>{{ connectionError }}</span>
        <button v-if="!connected" type="button" aria-label="重新连接" @click="connect">
          <RefreshCw :size="15" />
        </button>
        <button type="button" aria-label="关闭错误提示" @click="connectionError = ''">
          <X :size="15" />
        </button>
      </div>

      <CanDoList :disabled="!connected || booting || connecting || streaming" @select="fillDraft" />

      <form class="embed-composer" :class="{ sending: streaming }" @submit.prevent="send">
        <textarea
          ref="textarea"
          v-model="draft"
          aria-label="向罗山智能助手提问"
          :placeholder="
            connected ? '输入问题，Enter 发送，Shift + Enter 换行' : '服务未连接，暂不能发送'
          "
          :disabled="!connected || booting || connecting"
          rows="1"
          @keydown="keydown"
        />
        <div class="embed-composer-actions">
          <span>
            {{
              streaming
                ? '正在生成回答'
                : stopping
                  ? '正在确认停止…'
                  : '回答由 AI 生成，请核实重要信息'
            }}
          </span>
          <button
            v-if="streaming"
            class="embed-stop"
            type="button"
            aria-label="停止生成"
            @click="stop"
          >
            <Square :size="14" fill="currentColor" />
            停止
          </button>
          <button
            v-else
            class="embed-send"
            type="submit"
            aria-label="发送消息"
            :disabled="!canSend"
          >
            <Send :size="17" />
          </button>
        </div>
      </form>
    </section>
  </main>
</template>
