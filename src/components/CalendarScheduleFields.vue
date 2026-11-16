<script setup lang="ts">
import { calendarFrequencies, type ScheduleDraft } from '../schedules'
const draft = defineModel<ScheduleDraft>({ required: true })
defineProps<{ disabled?: boolean }>()
</script>

<template>
  <div v-if="calendarFrequencies.includes(draft.frequency)" class="calendar-fields">
    <label v-if="draft.frequency === 'yearly'">
      执行月份
      <select v-model.number="draft.yearMonth" :disabled="disabled" required>
        <option v-for="month in 12" :key="month" :value="month">{{ month }}月</option>
      </select>
    </label>
    <label>
      每月几日
      <select v-model.number="draft.monthDay" :disabled="disabled" required>
        <option v-for="day in 31" :key="day" :value="day">{{ day }}日</option>
      </select>
    </label>
    <p v-if="draft.frequency === 'quarterly'">每季度首月执行，即 1、4、7、10 月。</p>
    <p v-if="draft.frequency === 'yearly'">按所选月日执行；当前年度接口暂不支持 2 月 29 日。</p>
    <p v-else>当月没有所选日期时跳过，不会提前到月末执行。</p>
  </div>
</template>

<style scoped>
.calendar-fields {
  display: grid;
  gap: 12px;
}
label {
  display: grid;
  gap: 8px;
  color: #34445a;
  font-size: 14px;
}
select {
  width: 100%;
  min-height: 42px;
  padding: 9px 12px;
  border: 1px solid #dce6ef;
  border-radius: 8px;
  background: white;
  color: #22354a;
  font: inherit;
}
p {
  margin: 0;
  color: #677b90;
  font-size: 12px;
  line-height: 1.6;
}
</style>
