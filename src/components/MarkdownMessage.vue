<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
const props = defineProps<{ content: string }>()
const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.content, { async: false, breaks: true }), {
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'img', 'video', 'audio'],
    FORBID_ATTR: ['style'],
  }),
)
</script>
<template><div class="markdown" v-html="html"></div></template>
