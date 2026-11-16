export interface Attachment {
  name: string
  s3_url?: string
  url?: string
  size?: number
  [key: string]: unknown
}
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  reasoningCode?: string
  tools?: ToolCall[]
  status?: string
  error?: string
  streamWarnings?: string[]
  attachments?: Attachment[]
}
export interface Conversation {
  id: number
  title: string
  time: number
  messages?: Message[]
}
export interface Agent {
  name: string
  display_name?: string
}
export interface Model {
  id: number
  name: string
}
export interface StreamEvent {
  type: string
  content: unknown
  tool_name?: string
  tool_arguments?: unknown
  tool_call_id?: string
  agent_name?: string
  agent_id?: string | number
  invocation_id?: string
  depth?: number
  role?: string
}

export interface ToolCall {
  id: string
  callId?: string
  scope: string
  name: string
  agentName?: string
  arguments: string
  output: string
  error?: string
  status: 'running' | 'returned' | 'error' | 'stopped' | 'unknown'
}
