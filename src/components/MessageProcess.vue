<script setup lang="ts">
import { computed } from 'vue'
import {
  Sparkles,
  Wrench,
  ChevronDown,
  Terminal,
  Check,
  CircleAlert,
  LoaderCircle,
} from 'lucide-vue-next'
import type { Message } from '../types'
const props = defineProps<{ message: Message; running: boolean }>()
const activeTools = computed(
  () => props.message.tools?.filter((tool) => tool.status === 'running').length || 0,
)
const labels = {
  running: '调用中',
  returned: '已返回',
  error: '执行提示',
  stopped: '已停止接收',
  unknown: '未返回结果',
}
</script>
<template>
  <div class="message-process">
    <details v-if="message.thinking || message.reasoningCode" class="thinking" :open="running">
      <summary>
        <Sparkles :size="15" />
        思考过程
        <span v-if="running && !activeTools" class="process-live">进行中</span>
        <ChevronDown :size="14" />
      </summary>
      <p v-if="message.thinking">{{ message.thinking }}</p>
      <details v-if="message.reasoningCode" class="reasoning-code">
        <summary>
          <Terminal :size="14" />
          生成的代码
          <ChevronDown :size="14" />
        </summary>
        <pre>{{ message.reasoningCode }}</pre>
      </details>
    </details>
    <details v-if="message.tools?.length" class="tool-process" :open="running">
      <summary>
        <Wrench :size="15" />
        <span>
          工具调用
          <span class="tool-count">{{ message.tools.length }}</span>
        </span>
        <span v-if="running && activeTools" class="process-live">{{ activeTools }} 项进行中</span>
        <ChevronDown :size="14" />
      </summary>
      <div class="tool-list">
        <details
          v-for="(tool, index) in message.tools"
          :key="tool.id"
          class="tool-call"
          :data-status="tool.status"
        >
          <summary>
            <span class="tool-index">{{ index + 1 }}</span>
            <span class="tool-heading">
              <strong>{{ tool.name }}</strong>
              <small v-if="tool.agentName">{{ tool.agentName }}</small>
            </span>
            <span class="tool-state">
              <LoaderCircle v-if="tool.status === 'running'" :size="13" class="tool-spinner" />
              <Check v-else-if="tool.status === 'returned'" :size="13" />
              <CircleAlert v-else :size="13" />
              {{ labels[tool.status] }}
            </span>
            <ChevronDown :size="14" />
          </summary>
          <div class="tool-body">
            <template v-if="tool.arguments">
              <h4>调用参数 / 代码</h4>
              <pre class="tool-arguments">{{ tool.arguments }}</pre>
            </template>
            <template v-if="tool.output">
              <h4>返回结果</h4>
              <pre class="tool-output">{{ tool.output }}</pre>
            </template>
            <p v-if="tool.error" class="tool-error">{{ tool.error }}</p>
            <p v-if="!tool.output && !tool.error" class="tool-empty">
              {{
                tool.status === 'running' ? '等待工具返回…' : '本次流中没有收到该工具的返回结果。'
              }}
            </p>
          </div>
        </details>
      </div>
    </details>
  </div>
</template>
<style scoped>
.message-process {
  min-width: 0;
}
summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
summary > svg:last-child {
  margin-left: auto;
  flex-shrink: 0;
  transition: transform 0.15s;
}
details[open] > summary > svg:last-child {
  transform: rotate(180deg);
}
.thinking {
  color: #75889a;
  border-color: #e3eaf1;
  background: #f7f9fc;
}
.process-live {
  font-size: 11px;
  color: #398bbd;
  margin-left: auto;
  white-space: nowrap;
}
.reasoning-code {
  margin: 10px 12px 12px;
  border-top: 1px solid #e4ebf2;
  padding-top: 6px;
}
.reasoning-code summary {
  font-size: 12px;
  padding: 7px 0;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font:
    12px/1.7 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: #f3f7fb;
  color: #40596d;
}
.tool-process {
  border: 1px solid #dbeaf4;
  background: #fbfdff;
  border-radius: 9px;
  margin-bottom: 16px;
  color: #4382a6;
  font-size: 12px;
}
.tool-process > summary {
  padding: 10px 12px;
}
.tool-count {
  border-radius: 5px;
  background: #e6f2fb;
  padding: 1px 5px;
  margin-left: 4px;
  font-size: 11px;
}
.tool-list {
  padding: 0 10px 10px;
  display: grid;
  gap: 7px;
}
.tool-call {
  border: 1px solid #e2ecf3;
  background: white;
  border-radius: 7px;
  min-width: 0;
}
.tool-call > summary {
  padding: 10px;
  align-items: center;
}
.tool-index {
  color: #8196a6;
  font-size: 11px;
  flex-shrink: 0;
}
.tool-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}
.tool-heading strong {
  font-weight: 500;
  overflow-wrap: anywhere;
  color: #35576c;
}
.tool-heading small {
  font-size: 10px;
  color: #8b9ba8;
  overflow-wrap: anywhere;
}
.tool-state {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #6a8b9b;
  white-space: nowrap;
}
.tool-call[data-status='error'] .tool-state {
  color: #b57644;
}
.tool-call[data-status='returned'] .tool-state {
  color: #478b75;
}
.tool-body {
  padding: 0 12px 12px;
  border-top: 1px solid #edf2f6;
}
h4 {
  font-size: 11px;
  font-weight: 500;
  color: #8595a4;
  margin: 12px 0 6px;
}
.tool-error {
  color: #b56a46;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.tool-empty {
  font-size: 11px;
  color: #8595a4;
  margin-bottom: 0;
}
.tool-spinner {
  animation: tool-spin 1.5s linear infinite;
}
@keyframes tool-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tool-spinner {
    animation: none;
  }
}
@media (max-width: 767px) {
  .tool-call > summary {
    gap: 6px;
    padding: 9px 8px;
  }
  .tool-state {
    font-size: 9px;
  }
  .tool-list {
    padding: 0 7px 7px;
  }
}
</style>
