import { describe, expect, it } from 'vitest'
import { recordProcessEvent, settleProcessEvents } from '../src/process-events'
import type { Message, StreamEvent } from '../src/types'
const message = (): Message => ({ id: 'answer', role: 'assistant', content: '' })
describe('separate reasoning and tool events', () => {
  it('keeps reasoning and generated code out of the answer body', () => {
    const m = message()
    for (const event of [
      { type: 'model_output_thinking', content: '先检查' },
      { type: 'model_output_deep_thinking', content: '设备状态' },
      { type: 'model_output_code', content: 'print(1)' },
    ])
      expect(recordProcessEvent(m, event)).toBe(true)
    expect(m.thinking).toBe('先检查设备状态')
    expect(m.reasoningCode).toBe('print(1)')
    expect(m.content).toBe('')
    expect(recordProcessEvent(m, { type: 'final_answer', content: '结论' })).toBe(false)
  })
  it('matches parallel results by stable call id without attaching orphan logs to another tool', () => {
    const m = message()
    const events: StreamEvent[] = [
      {
        type: 'tool',
        content: '',
        tool_name: '检查温度',
        tool_arguments: { device: 'A' },
        tool_call_id: 'a',
      },
      {
        type: 'tool',
        content: '',
        tool_name: '检查电流',
        tool_arguments: { device: 'B' },
        tool_call_id: 'b',
      },
      { type: 'execution_logs', content: '温度正常', tool_call_id: 'a' },
      { type: 'execution_logs', content: '未知调用结果', tool_call_id: 'c' },
      { type: 'execution_logs', content: { amps: 3 }, tool_call_id: 'b' },
      { type: 'execution_logs', content: '，25℃', tool_call_id: 'a' },
    ]
    events.forEach((e) => recordProcessEvent(m, e))
    expect(m.tools).toHaveLength(3)
    expect(m.tools![0]).toMatchObject({
      name: '检查温度',
      output: '温度正常，25℃',
      arguments: '{\n  "device": "A"\n}',
      status: 'returned',
    })
    expect(m.tools![1]!.output).toContain('"amps": 3')
    expect(m.tools![2]).toMatchObject({ name: '执行记录', output: '未知调用结果' })
  })
  it('handles legacy parse logs and retains explicit errors without stopping later events', () => {
    const m = message()
    recordProcessEvent(m, { type: 'parse', content: 'print(1)' })
    recordProcessEvent(m, { type: 'execution_logs', content: '1' })
    expect(m.tools![0]).toMatchObject({ name: 'Python 解释器', output: '1', status: 'returned' })
    recordProcessEvent(m, { type: 'tool', content: '', tool_name: 'read', tool_call_id: 'x' })
    expect(recordProcessEvent(m, { type: 'error', content: 'failed', tool_call_id: 'x' })).toBe(
      false,
    )
    recordProcessEvent(m, { type: 'execution_logs', content: 'diagnostic', tool_call_id: 'x' })
    recordProcessEvent(m, { type: 'model_output_thinking', content: '重新推理' })
    expect(m.tools![1]).toMatchObject({ error: 'failed', status: 'error', output: 'diagnostic' })
    expect(m.thinking).toBe('重新推理')
  })
  it('isolates sub-agent invocation scopes and does not turn child answers into the final answer', () => {
    const m = message()
    for (const invocation_id of ['first', 'second'])
      recordProcessEvent(m, { type: 'tool', content: 'args', tool_call_id: 'same', invocation_id })
    recordProcessEvent(m, {
      type: 'execution_logs',
      content: 'first output',
      tool_call_id: 'same',
      invocation_id: 'first',
    })
    expect(m.tools![1]!.output).toBe('')
    expect(
      recordProcessEvent(m, {
        type: 'final_answer',
        content: '子任务结果',
        depth: 1,
        agent_name: '子助手',
        invocation_id: 'first',
      }),
    ).toBe(true)
    expect(m.content).toBe('')
    expect(m.tools!.at(-1)).toMatchObject({ name: '子助手 · 子任务结果', output: '子任务结果' })
  })
  it('does not claim tool success merely because the stream ended or was stopped', () => {
    for (const stopped of [false, true]) {
      const m = message()
      recordProcessEvent(m, { type: 'tool', content: '', tool_name: 'pending' })
      settleProcessEvents(m, stopped)
      expect(m.tools![0]!.status).toBe(stopped ? 'stopped' : 'unknown')
    }
  })
})
