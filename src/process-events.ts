import type { Message, StreamEvent, ToolCall } from './types'
import { eventText } from './api'
import { uuid } from './uuid'

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value, null, 2)
}
function scope(event: StreamEvent) {
  return event.invocation_id || String(event.agent_id ?? event.agent_name ?? '')
}
function findTool(message: Message, event: StreamEvent) {
  const tools = message.tools || []
  const eventScope = scope(event)
  return [...tools]
    .reverse()
    .find(
      (tool) =>
        (!eventScope || tool.scope === eventScope) &&
        (event.tool_call_id ? tool.callId === event.tool_call_id : true),
    )
}
function addTool(message: Message, event: StreamEvent, name: string): ToolCall {
  const tool: ToolCall = {
    id: uuid(),
    callId: event.tool_call_id,
    scope: scope(event),
    name,
    agentName: event.agent_name,
    arguments: '',
    output: '',
    status: 'running',
  }
  ;(message.tools ||= []).push(tool)
  return tool
}

// Returns true for process-only events so they cannot leak into the answer body.
export function recordProcessEvent(message: Message, event: StreamEvent): boolean {
  if (['reasoning', 'model_output_thinking', 'model_output_deep_thinking'].includes(event.type)) {
    message.thinking = (message.thinking || '') + eventText(event.content)
    message.status = '正在思考'
    return true
  }
  if (event.type === 'model_output_code') {
    message.reasoningCode = (message.reasoningCode || '') + eventText(event.content)
    message.status = '正在规划工具调用'
    return true
  }
  if (['tool', 'tool-call', 'parse'].includes(event.type)) {
    const tool =
      (event.tool_call_id && findTool(message, event)) ||
      addTool(
        message,
        event,
        event.tool_name || (event.type === 'parse' ? 'Python 解释器' : event.role || '工具调用'),
      )
    if (event.tool_name) tool.name = event.tool_name
    tool.arguments = printable(event.tool_arguments ?? event.content)
    message.status = '正在调用工具'
    return true
  }
  if (event.type === 'execution_logs') {
    // An unknown stable ID must never attach to another parallel call.
    const tool = findTool(message, event) || addTool(message, event, event.tool_name || '执行记录')
    tool.output += printable(event.content)
    if (tool.status !== 'error') tool.status = 'returned'
    return true
  }
  if (['error', 'agent_error'].includes(event.type) && event.tool_call_id) {
    const tool = findTool(message, event) || addTool(message, event, event.tool_name || '工具调用')
    tool.error = eventText(event.content) || '执行出错'
    tool.status = 'error'
  }
  if (
    event.type === 'agent_finish' ||
    (event.type === 'final_answer' && (Number(event.depth) > 0 || event.invocation_id))
  ) {
    const output = printable(event.content)
    if (output) {
      const tool = addTool(
        message,
        event,
        event.agent_name ? `${event.agent_name} · 子任务结果` : '子智能体结果',
      )
      tool.output = output
      tool.status = 'returned'
    }
    return true
  }
  return false
}

export function settleProcessEvents(message: Message, stopped: boolean) {
  for (const tool of message.tools || []) {
    // A finished answer is not evidence that every tool succeeded.
    if (tool.status === 'running') tool.status = stopped ? 'stopped' : 'unknown'
  }
}
