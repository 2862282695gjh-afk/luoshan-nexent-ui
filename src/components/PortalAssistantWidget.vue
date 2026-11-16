<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ExternalLink, Maximize2, Minimize2, Minus, X } from 'lucide-vue-next'
import AssistantEmblem from './AssistantEmblem.vue'

const visible = ref(false)
const activated = ref(false)
const expanded = ref(false)
const panel = ref<HTMLElement>()

function openAssistant() {
  activated.value = true
  visible.value = true
  void nextTick(() => panel.value?.focus())
}

function closeAssistant() {
  visible.value = false
  expanded.value = false
}

function toggleSize() {
  expanded.value = !expanded.value
  void nextTick(() => panel.value?.focus())
}
</script>

<template>
  <aside class="portal-assistant" aria-label="罗山智能助手">
    <Transition name="assistant-panel">
      <section
        v-if="activated"
        v-show="visible"
        ref="panel"
        class="portal-assistant-panel"
        :class="{ 'is-expanded': expanded }"
        tabindex="-1"
      >
        <header class="portal-assistant-header">
          <div class="portal-assistant-title">
            <div class="portal-assistant-mark"><AssistantEmblem /></div>
            <div>
              <strong>罗山智能助手</strong>
              <span>园区运维 · 随时相伴</span>
            </div>
          </div>
          <div class="portal-assistant-controls">
            <a
              class="portal-assistant-full-page"
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="打开完整对话（新标签页）"
              title="打开完整对话（新标签页）"
            >
              <ExternalLink :size="16" />
              <span>完整对话</span>
            </a>
            <button
              type="button"
              :aria-label="expanded ? '还原对话窗口' : '展开对话窗口'"
              @click="toggleSize"
            >
              <Minimize2 v-if="expanded" :size="17" />
              <Maximize2 v-else :size="17" />
            </button>
            <button type="button" aria-label="最小化 AI 智能助手" @click="closeAssistant">
              <Minus :size="18" />
            </button>
            <button type="button" aria-label="关闭 AI 智能助手" @click="closeAssistant">
              <X :size="18" />
            </button>
          </div>
        </header>
        <!-- v-show keeps the loaded frame and current conversation alive after minimize. -->
        <iframe
          class="portal-assistant-frame"
          src="/embed/?chrome=0"
          title="罗山智能助手对话"
          allow="clipboard-write"
        ></iframe>
      </section>
    </Transition>

    <button
      v-show="!visible"
      class="portal-assistant-ball"
      type="button"
      aria-label="打开 AI 智能助手"
      :aria-expanded="visible"
      @click="openAssistant"
    >
      <span class="portal-assistant-ball-glow"></span>
      <AssistantEmblem />
      <span class="portal-assistant-ball-label">AI 助手</span>
    </button>
  </aside>
</template>

<style scoped>
.portal-assistant {
  position: fixed;
  z-index: 30;
  right: clamp(20px, 2.2vw, 42px);
  bottom: clamp(20px, 3vh, 36px);
  pointer-events: none;
}

.portal-assistant-panel,
.portal-assistant-ball {
  pointer-events: auto;
}

.portal-assistant-panel {
  display: flex;
  width: min(420px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 72px));
  min-height: 440px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(132, 212, 247, 0.74);
  border-radius: 20px;
  outline: none;
  background: #f7fbff;
  box-shadow:
    0 26px 62px rgba(13, 85, 135, 0.22),
    0 6px 17px rgba(21, 121, 177, 0.13);
}

.portal-assistant-panel.is-expanded {
  width: min(680px, calc(100vw - 48px));
  height: min(760px, calc(100vh - 52px));
}

.portal-assistant-header {
  display: flex;
  height: 65px;
  flex: 0 0 65px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px 9px 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.27);
  color: white;
  background:
    radial-gradient(circle at 17% -45%, rgba(198, 245, 255, 0.58), transparent 41%),
    linear-gradient(110deg, #0874b9, #078ecc 68%, #21afd7);
}

.portal-assistant-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.portal-assistant-mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.17);
}

.portal-assistant-mark :deep(.assistant-emblem) {
  width: 45px;
  height: 48px;
  transform: translateY(2px);
}

.portal-assistant-title > div:last-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.portal-assistant-title strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-assistant-title span {
  display: flex;
  align-items: center;
  gap: 5px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 10px;
}

.portal-assistant-title i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #a4f4ca;
  box-shadow: 0 0 0 3px rgba(164, 244, 202, 0.13);
}

.portal-assistant-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.portal-assistant-controls button,
.portal-assistant-controls a {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.88);
  background: transparent;
  transition: background 0.17s ease;
}

.portal-assistant-controls button:hover,
.portal-assistant-controls a:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
}

.portal-assistant-controls .portal-assistant-full-page {
  display: inline-flex;
  width: auto;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  margin-right: 3px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 11px;
  text-decoration: none;
  white-space: nowrap;
}

.portal-assistant-frame {
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1;
  border: 0;
  background: #f7fbff;
}

.portal-assistant-ball {
  position: relative;
  display: grid;
  width: 74px;
  height: 74px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.82);
  border-radius: 50%;
  color: white;
  isolation: isolate;
  background:
    radial-gradient(circle at 30% 14%, rgba(255, 255, 255, 0.8), transparent 17%),
    linear-gradient(143deg, #0876bd 0%, #0d9dd1 50%, #697ee6 104%);
  box-shadow:
    0 15px 29px rgba(15, 105, 176, 0.31),
    inset 0 1px 0 rgba(255, 255, 255, 0.52);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.portal-assistant-ball:hover {
  box-shadow:
    0 19px 35px rgba(15, 105, 176, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.56);
  transform: translateY(-3px);
}

.portal-assistant-ball:focus-visible,
.portal-assistant-controls button:focus-visible,
.portal-assistant-controls a:focus-visible {
  outline: 3px solid rgba(187, 240, 255, 0.8);
  outline-offset: 3px;
}

.portal-assistant-ball :deep(.assistant-emblem) {
  position: absolute;
  z-index: 1;
  top: 6px;
  width: 57px;
  height: 59px;
}

.portal-assistant-ball-label {
  position: absolute;
  z-index: 2;
  right: 7px;
  bottom: 7px;
  padding: 2px 5px;
  border: 1px solid rgba(255, 255, 255, 0.38);
  border-radius: 999px;
  color: #fff;
  background: rgba(5, 100, 179, 0.45);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.03em;
}

.portal-assistant-ball-glow {
  position: absolute;
  z-index: -1;
  width: 85%;
  height: 85%;
  border-radius: 50%;
  background: rgba(44, 174, 225, 0.52);
  filter: blur(16px);
  animation: assistant-glow 2.6s ease-in-out infinite;
}

.assistant-panel-enter-active,
.assistant-panel-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.assistant-panel-enter-from,
.assistant-panel-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.97);
}

@keyframes assistant-glow {
  50% {
    opacity: 0.58;
    transform: scale(1.12);
  }
}

@media (max-width: 600px) {
  .portal-assistant {
    right: 12px;
    bottom: 12px;
  }

  .portal-assistant-panel,
  .portal-assistant-panel.is-expanded {
    width: calc(100vw - 24px);
    height: min(650px, calc(100vh - 28px));
    min-height: min(440px, calc(100vh - 28px));
    border-radius: 17px;
  }

  .portal-assistant-ball {
    width: 65px;
    height: 65px;
    border-radius: 50%;
  }

  .portal-assistant-ball :deep(.assistant-emblem) {
    top: 3px;
    width: 53px;
    height: 56px;
  }
}

@media (max-width: 380px) {
  .portal-assistant-full-page span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .portal-assistant-panel,
  .portal-assistant-ball,
  .portal-assistant-controls button,
  .portal-assistant-controls a {
    transition: none;
  }

  .portal-assistant-ball-glow {
    animation: none;
  }
}
</style>
