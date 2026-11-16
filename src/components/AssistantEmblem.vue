<script setup lang="ts">
import { useId } from 'vue'
const id = useId()
</script>

<template>
  <svg class="assistant-emblem" viewBox="0 0 160 170" fill="none" aria-hidden="true">
    <defs>
      <linearGradient
        :id="`${id}-rim`"
        x1="18"
        y1="37"
        x2="138"
        y2="106"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#c699ff" />
        <stop offset=".45" stop-color="#8886ff" />
        <stop offset="1" stop-color="#03c6ed" />
      </linearGradient>
      <linearGradient
        :id="`${id}-glass`"
        x1="39"
        y1="20"
        x2="127"
        y2="137"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#fff0ff" />
        <stop offset=".48" stop-color="#d9f8ff" />
        <stop offset="1" stop-color="#75a6ff" />
      </linearGradient>
      <linearGradient
        :id="`${id}-mark`"
        x1="38"
        y1="88"
        x2="116"
        y2="47"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#7339ff" />
        <stop offset="1" stop-color="#30b8e8" />
      </linearGradient>
      <radialGradient :id="`${id}-shadow`">
        <stop stop-color="#3378f5" stop-opacity=".34" />
        <stop offset="1" stop-color="#3378f5" stop-opacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="80" cy="149" rx="68" ry="19" :fill="`url(#${id}-shadow)`" />
    <circle cx="80" cy="77" r="64" fill="#6462ff" />
    <circle cx="80" cy="73" r="64" :fill="`url(#${id}-rim)`" />
    <circle
      cx="80"
      cy="73"
      r="59"
      :fill="`url(#${id}-glass)`"
      stroke="white"
      stroke-opacity=".5"
      stroke-width="2"
    />
    <path
      d="M24 89c9-12 13 20 26 8s14 25 34 22 32-22 42-8c-20 28-71 34-102-22Z"
      fill="#a095ff"
      fill-opacity=".44"
    />
    <path
      d="M26 66a55 55 0 0 1 61-47"
      stroke="white"
      stroke-width="3"
      stroke-linecap="round"
      opacity=".65"
    />
    <path
      d="M133 66a54 54 0 0 1-28 55"
      stroke="#6a82ff"
      stroke-width="3"
      stroke-linecap="round"
      opacity=".5"
    />
    <path d="m79 36 38 37-38 38-38-38 38-37Z" :fill="`url(#${id}-mark)`" />
    <path
      d="m57 41 8 8-9 9-8-8 9-9Zm12-12 6 6-6 6-6-6 6-6Zm11-9 5 5-5 5-5-5 5-5Zm10 9 4 4-4 4-4-4 4-4Z"
      fill="#8a99ff"
    />
    <path d="M63 62h34v30H84l-5 5-5-5H63V62Z" fill="white" />
    <path d="M70 71h6v9h-6zm14 0h6v9h-6z" fill="#657cfa" />
    <circle cx="123" cy="45" r="2" fill="white" opacity=".9" />
    <circle cx="129" cy="53" r="1" fill="white" />
  </svg>
</template>
