<script setup lang="ts">
import { onBeforeUnmount, ref, type Component } from 'vue'
import {
  Activity,
  ArrowUpRight,
  BookMarked,
  ChartPie,
  ChevronUp,
  ClipboardCheck,
  FileText,
} from 'lucide-vue-next'
import { canDoCapabilities, type CanDoIcon } from '../can-do'

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ select: [prompt: string] }>()

const activeId = ref<string | null>(null)
let closeTimer: ReturnType<typeof setTimeout> | undefined

const icons: Record<CanDoIcon, Component> = {
  knowledge: BookMarked,
  analysis: ChartPie,
  prediction: Activity,
  inspection: ClipboardCheck,
  report: FileText,
}

function open(id: string) {
  cancelClose()
  if (!props.disabled) activeId.value = id
}

function cancelClose() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = undefined
}

function close() {
  cancelClose()
  activeId.value = null
}

function closeAfterPointerLeaves() {
  cancelClose()
  closeTimer = setTimeout(() => {
    activeId.value = null
  }, 180)
}

function closeAfterFocusLeaves(event: FocusEvent) {
  const current = event?.currentTarget as HTMLElement | undefined
  const nextTarget = event?.relatedTarget as Node | null | undefined
  if (current?.contains(nextTarget ?? null)) return
  close()
}

function selectExample(prompt: string) {
  if (props.disabled) return
  close()
  emit('select', prompt)
}

onBeforeUnmount(cancelClose)
</script>

<template>
  <section class="can-do-list" aria-label="可用能力">
    <div class="can-do-list-caption">
      <strong>CAN DO</strong>
      <span>选择能力，查看常用问法</span>
    </div>
    <div class="can-do-rail">
      <div
        v-for="capability in canDoCapabilities"
        :key="capability.id"
        class="can-do-capability-slot"
        @mouseenter="open(capability.id)"
        @mouseleave="closeAfterPointerLeaves"
        @focusout="closeAfterFocusLeaves"
      >
        <Transition name="can-do-popover">
          <section
            v-if="activeId === capability.id"
            :id="`can-do-examples-${capability.id}`"
            class="can-do-popover"
            :aria-label="`${capability.label}示例问题`"
            @mouseenter="cancelClose"
          >
            <div class="can-do-popover-heading">
              <div>
                <strong>{{ capability.label }}</strong>
                <p>{{ capability.description }}</p>
              </div>
              <span>点击示例填入问题</span>
            </div>
            <div class="can-do-examples">
              <button
                v-for="prompt in capability.examples"
                :key="prompt"
                type="button"
                :disabled="disabled"
                @click="selectExample(prompt)"
              >
                <span>{{ prompt }}</span>
                <ArrowUpRight :size="15" />
              </button>
            </div>
          </section>
        </Transition>
        <button
          class="can-do-capability"
          :class="{ active: activeId === capability.id }"
          type="button"
          :disabled="disabled"
          :aria-expanded="activeId === capability.id"
          :aria-controls="`can-do-examples-${capability.id}`"
          @focus="open(capability.id)"
          @click="open(capability.id)"
          @keydown.esc.prevent="close"
        >
          <component :is="icons[capability.icon]" :size="18" />
          <span>{{ capability.label }}</span>
          <ChevronUp class="can-do-chevron" :size="14" />
        </button>
      </div>
    </div>
  </section>
</template>
