# Nexent v2.5.1 北向接口说明文档

> **版本基线**：`v2.5.1-intranet` @ commit `43c227c70`（本地联调含两处后端修复：`chat/run` 的 `AppException` 直通、`/nb/v1/models` 字段脱敏——见 §6.4 修订记录）。镜像 `nexent/nexent-data-process:v2.5.1` 系。
> 依据源码整理（`backend/apps/northbound_app.py`、`northbound_knowledge_app.py`、`northbound_base_app.py`，及对应 service / consts），全部错误码与响应体均经本地实例实测核对。
> 官方文档只覆盖 A2A 协议部分；`/nb/v1` 与 `/nb/v1/knowledge` 两块无官方文档，本文以源码+实测为准。
> 服务自带交互式文档：`http://<host>:30013/docs`（Swagger UI）与 `/redoc`，参数 Schema 以其为准。

---

## 1. 概述

北向服务（`nexent-northbound`）是一个独立 FastAPI 应用，供外部子系统/上层平台以编程方式调用 Nexent 的对话、知识库与 A2A Agent 能力。

| 项 | 值 |
|---|---|
| 容器端口 | 5013 |
| K8s NodePort | 30013 |
| 接口前缀 | `/nb/v1`（通用）、`/nb/v1/knowledge`(知识库)、`/nb/a2a`（A2A 协议） |
| 交互式文档 | `GET /docs`、`GET /redoc` |
| 健康检查 | `GET /nb/v1/health`（无需鉴权）→ `{"status": "healthy", "service": "northbound-api"}` |

**接口总览**

| 分组 | 数量 | 说明 |
|---|---|---|
| `/nb/v1` 通用 | 16 | 对话运行/停止、附件、会话、Agent、模型、文件代理、API Key 管理 |
| `/nb/v1/knowledge` 知识库 | 9 | 索引管理、混合检索、文件上传下载（限资产管理员租户） |
| `/nb/a2a` A2A | 5 | Agent Card、JSON-RPC、REST message:send/stream、任务查询 |

---

## 2. 鉴权

### 2.1 API Key（Bearer Token）与免鉴权例外

除三个例外（见下），**所有北向接口均需**：

```
Authorization: Bearer <access_key>
```

**免鉴权例外（共 3 个）**：

| 路径 | 说明 |
|---|---|
| `GET /nb/v1/health` | 健康检查 |
| `GET /nb/v1/file/fetch` | MinIO 预签名 URL 文件代理（凭预签名 URL 本身鉴权） |
| `GET /nb/a2a/{endpoint_id}/.well-known/agent-card.json` | **Agent Card 发现端点**。当前实现不做 Bearer 校验（路由未走 `_get_northbound_context`），符合 A2A 规范「发现端点公开」的惯例。注意：这是公开只读端点，只暴露 Agent 元信息（名称/描述/能力/URL），不含密钥；但若不希望 endpoint_id 被外部枚举，需在网络层（Ingress/防火墙）限制该路径 |

- Bearer 是 **API Key（access_key）**，不是 JWT。服务端拿 access_key 反查 `user_token_info_t` / `user_tenant_t`，解析出 `user_id`、`tenant_id`、`token_id`。
- 每次调用会记录 token 用量（`log_token_usage`），租户级计量。

### 2.2 API Key 的获取与管理

API Key 由**租户管理员**（TENANT_ADMIN）通过北向接口自助发放（也可走平台页面）：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/nb/v1/api-users/batch` | POST | 批量创建 API 专用用户并发放 key，`201` |
| `/nb/v1/api-keys/refresh` | POST | 吊销目标用户全部旧 key，发一把新 key |
| `/nb/v1/api-keys` | DELETE | 吊销目标用户全部 key（`?user_id=` 或 `?email=`，二选一） |

**批量创建**（最常用的发 key 入口）：

```bash
curl -X POST "http://<host>:30013/nb/v1/api-users/batch" \
  -H "Authorization: Bearer <管理员的access_key>" \
  -H "Content-Type: application/json" \
  -d '{"role": "USER", "count": 1}'
```

请求体（`ApiUserBatchCreateRequest`）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `role` | string | 否 | `"DEV"` \| `"USER"`，默认 `USER` | API 用户角色 |
| `group_id` | int | 否 | ≥1 | 归属用户组；不传用默认组 |
| `count` | int | 否 | 1–100，默认 1 | 一次创建的用户数 |

响应 `data` 为数组，每项含 **`api_key`**（即 access_key，只在此响应中出现一次，务必保存）：

```json
{"message": "success", "requestId": "...", "data": [
  {"user_id": "uuid", "role": "USER", "group_id": 1, "group_name": "...", "api_key": "sk-..."}
]}
```

refresh / revoke 的目标用 `user_id` 或 `email` **精确二选一**（同时传或都不传 → 400 `Exactly one of user_id or email must be provided`）。refresh 返回 `{"user_id", "email", "api_key": "新key", "revoked_count": N}`。

### 2.3 可选请求头

| Header | 说明 |
|---|---|
| `X-Request-Id` | 请求追踪 ID，不传则服务端生成 uuid4；响应/流首部会回带 |
| `Idempotency-Key` | 幂等键，见 §3.2（注意其真实语义：**只防并发重复启动**，不是请求级幂等） |

---

## 3. `/nb/v1` 通用接口

### 3.1 接口清单

| # | 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|---|
| 1 | GET | `/nb/v1/health` | 无 | 健康检查 |
| 2 | POST | `/nb/v1/chat/run` | ✓ | 运行 Agent 对话（SSE 流式） |
| 3 | GET | `/nb/v1/chat/stop/{conversation_id}` | ✓ | 停止进行中的对话 |
| 4 | POST | `/nb/v1/chat/attachments/upload` | ✓ | 上传对话附件，返回 `object_name` |
| 5 | GET | `/nb/v1/conversations` | ✓ | 会话列表 |
| 6 | GET | `/nb/v1/conversations/{conversation_id}` | ✓ | 会话历史消息 |
| 7 | PUT | `/nb/v1/conversations/{conversation_id}/title` | ✓ | 修改会话标题 |
| 8 | POST | `/nb/v1/generate_title` | ✓ | 由问题生成并持久化标题 |
| 9 | GET | `/nb/v1/agents` | ✓ | 已发布 Agent 列表 |
| 10 | GET | `/nb/v1/agents/{agent_name}` | ✓ | 单个 Agent 详情 |
| 11 | GET | `/nb/v1/agents/{agent_name}/knowledge-bases` | ✓ | Agent 可用知识库 |
| 12 | GET | `/nb/v1/models` | ✓ | 租户已配置模型列表（脱敏投影，见 §3.4） |
| 13 | GET | `/nb/v1/file/fetch` | **无** | MinIO 预签名 URL 文件代理 |
| 14 | POST | `/nb/v1/api-users/batch` | ✓ 管理员 | 批量发 key（见 §2.2） |
| 15 | POST | `/nb/v1/api-keys/refresh` | ✓ 管理员 | 换发 key |
| 16 | DELETE | `/nb/v1/api-keys` | ✓ 管理员 | 吊销 key |

### 3.2 核心接口：`POST /nb/v1/chat/run`

以 SSE（`text/event-stream`）流式运行 Agent。请求体字段（均为 Body 顶层字段）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `agent_name` | string | ✓ | 目标 Agent 名（须已发布；且必须是合法 Python 标识符——创建 Agent 时平台已约束，连字符等字符会导致运行报错） |
| `query` | string | ✓ | 用户输入 |
| `conversation_id` | int | 否 | 已有会话 ID；**不传则新建会话**，流首事件回带新 ID |
| `attachments` | list | 否 | 附件；先调 #4 上传拿 `object_name`，此处传 object_name 字符串数组或完整对象数组 |
| `model_id` | int | 否 | 本次运行使用的模型 ID，覆盖 Agent 默认模型（同 Agent 换模型问答） |
| `metadata` | object | 否 | 运行时元数据，注入 Agent 运行上下文。约束：≤64KB、深度≤10、键数≤200、数组项≤1000、键长≤256；超限 → **413**（`CHAT_METADATA_TOO_LARGE`），结构非法 → **422**（`CHAT_METADATA_INVALID`） |
| `meta_data` | object | 否 | 透传元数据，仅用于审计/用量日志，不进 Agent |
| `tool_params` | object | 否 | 工具参数单次覆盖，见下 |

示例：

```bash
curl -N -X POST "http://<host>:30013/nb/v1/chat/run" \
  -H "Authorization: Bearer <access_key>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-req-001" \
  -d '{
    "agent_name": "general_assistant",
    "query": "总结这份报告的风险点",
    "attachments": ["attachments/user123/20260908171738_ce608222.txt"],
    "meta_data": {"source": "crm", "ticket_id": "INC-1001"}
  }'
```

**tool_params 结构**（对 DB 中 `ag_tool_instance_t.params` 做单次覆盖，请求值优先；工具先按 `name` 再按 `class_name` 匹配；未知参数名 → 400；`vdb_core`、`embedding_model` 等派生字段由合并后参数重算）：

```json
{
  "agents": {
    "<agent_name>": {
      "tools": {
        "<tool_name>": { "top_k": 10, "rerank": true }
      }
    }
  }
}
```

**响应头**：`X-Request-Id`、`conversation_id`（新建与既有会话都回带）、`Content-Type: text/event-stream`、`X-Accel-Buffering: no`（代理勿缓冲）。

#### 3.2.1 SSE 事件生命周期（重要，按实测归纳）

每条形如 `data: {"type": "...", "content": "...", "unit_index": N}\n\n`。一次成功运行的实测完整序列：

```
conversation_created → tool → execution_logs → other → agent_new_run
→ step_count → model_output_thinking → token_count → final_answer   [流关闭]
```

**事件分类**：

| 类别 | `type` 值 | 语义 | 消费方式 |
|---|---|---|---|
| 会话标识 | `conversation_created` | 新建会话的 ID（仅新会话首条） | 记录 `content.conversation_id`，一次即止 |
| 思考增量 | `model_output_thinking` | 推理过程增量片段 | **追加渲染**（可折叠区） |
| 正文增量 | `model_output` / `model_output_code` / `model_output_deep_thinking` | 回复正文增量片段 | **追加渲染** |
| 工具/日志 | `tool`、`execution_logs`、`step_count`、`token_count`、`other`、`agent_new_run` | 过程观测 | 展示或忽略 |
| **完整答案** | `final_answer` | **整段完整最终答案（非增量）** | **整体替换**此前累积的正文，不是追加 |
| 运行内错误 | `error` | Agent 运行中某步失败（HTTP 仍是 200） | 展示/记录，见下 |
| 结束标记 | `agent_finish` | 运行正常结束的标记 | 见下——**不能单独依赖它判结束** |

**结束判定规则（实测）**：

1. **流关闭（EOF）才是唯一可靠的结束信号。** 实测成功运行可以 `final_answer` 结尾直接关流，**不发送 `agent_finish`**。若把「等 `agent_finish`」当唯一退出条件，连接会挂到超时。
2. 正确的客户端状态机：读到 `final_answer` → 用它整体替换已渲染正文并标记「答案已定」；读到 `agent_finish` 或流 EOF → 结束读取。两者先到为准。
3. **HTTP 200 不代表运行成功**：流中可能出现 `{"type":"error", "content":"..."}`（Agent 内部工具失败、模型调用失败等），甚至 `error` 之后仍会跟一条 `final_answer`（内容可能是 "Run Agent Error: ..."）。前端应把含 `error` 事件的响应当作失败或降级展示，并以 `final_answer` 是否含错误前缀做兜底判断。
4. **断流处理**：本服务不支持 SSE `Last-Event-ID` 重连。连接中断即本次运行结果丢失（用户消息已落库，可在 `/conversations/{id}` 查到；Agent 回复可能不完整）。补救：调 `GET /chat/stop/{id}` 清理运行态后，带同一 `conversation_id` 重新提问（历史上下文会自动带上），或直接查历史接口看是否有最终回复。

**限流与幂等**（租户级，环境变量可调）：

| 项 | 默认 | 触发行为 |
|---|---|---|
| 限流 | 开启，120 次/分钟/租户（`NORTHBOUND_RATE_LIMIT_PER_MINUTE`） | `429 Too Many Requests: rate limit exceeded` |
| 幂等锁 | TTL 600 秒（`NORTHBOUND_IDEMPOTENCY_TTL_SECONDS`） | `429 Duplicate request is still running, please wait.` |

**幂等的真实语义（与实现核对，勿过度依赖）**：

- 实现是在**拿到上游 runtime 的流响应对象后**约 3 秒即释放锁（`_release_idempotency_after_delay` 是 fire-and-forget task，不等流消费完）。它只拦「同一请求在**启动后 ~3 秒内**的并发重复」，**不覆盖长流式请求的全过程**——长请求进行中超过 3 秒后，同样的 key 再发不会被拦。
- 新会话场景：会话先创建、拿到 ID 后才计算去重键，所以重复请求会各建一个新会话（除非显式传 `Idempotency-Key`）。
- 结论：**调用方必须自己做防重**（前端按钮置灰、网关层去重等）；`Idempotency-Key` 只能当「防手抖双击」的辅助，不是请求级幂等保证。

**多轮对话**：第一次不传 `conversation_id` → 从首事件取新 ID → 后续请求带上同一 `conversation_id`，服务端自动拉取历史作为上下文。

### 3.3 会话接口：返回结构与示例（实测）

#### `GET /nb/v1/conversations` — 会话列表

列表在 **`data[]`**（数组），按更新时间倒序，时间为**毫秒时间戳**：

```json
{
  "message": "success",
  "data": [
    {
      "conversation_id": 19,
      "conversation_title": "New Conversation",
      "agent_id": 3,
      "chat_mode": "execution",
      "create_time": 1788863629000,
      "update_time": 1788863629000
    }
  ],
  "requestId": "uuid"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `conversation_id` | int | 会话 ID，后续接口的路径参数 |
| `conversation_title` | string | 标题；未生成过标题时为 `"New Conversation"` |
| `agent_id` | int | 归属 Agent |
| `chat_mode` | string | 固定 `execution`（北向运行） |
| `create_time` / `update_time` | int | **毫秒时间戳**（非秒、非 ISO 字符串） |

#### `GET /nb/v1/conversations/{id}` — 历史消息

历史在 **`data.history[]`**（注意比列表多一层嵌套），按时间正序：

```json
{
  "message": "success",
  "data": {
    "conversation_id": 9,
    "history": [
      {"role": "user", "content": "你好，用一句话介绍你自己", "minio_files": []},
      {"role": "assistant", "content": "我是Nexent，……", "minio_files": []}
    ]
  },
  "requestId": "uuid"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `role` | string | `user` / `assistant`（过滤其他角色） |
| `content` | string | 完整消息文本（assistant 为最终答案全文，非增量） |
| `minio_files` | array | 该条消息携带的附件描述（无则空数组） |

#### `PUT /nb/v1/conversations/{id}/title?title=新标题`

`title` 走 **Query 参数**（URL 编码）；可带 `meta_data`（Query，JSON 字符串）与 `Idempotency-Key`。成功返回：

```json
{"message": "success", "data": 8, "requestId": "uuid", "idempotency_key": "tenant:8:sha256..."}
```

`data` 为被改的会话 ID。会话不存在 → 404。

#### `POST /nb/v1/generate_title`

Body `{"conversation_id": int, "question": str}`，由 LLM 生成并持久化标题。成功返回 `{"message": "success", "data": "生成的标题", "requestId": ...}`。会话不存在 → 404。

### 3.4 `GET /nb/v1/models` — 模型列表（脱敏投影）

返回租户已配置的**全部类型**模型（LLM/主模型、embedding、TTS、STT 都会出现），列表在 `data[]`。**响应只含以下脱敏字段，不含 `api_key` / `base_url` 等凭据与内部字段**：

```json
{
  "message": "success",
  "data": [
    {
      "model_id": 7,
      "model_name": "qwen-plus",
      "display_name": "主模型",
      "model_factory": "OpenAI-API-Compatible",
      "model_type": "llm",
      "connect_status": "available",
      "max_tokens": 4096,
      "context_window_tokens": 32768,
      "max_output_tokens": 4096
    }
  ],
  "requestId": "uuid"
}
```

| 字段 | 说明 |
|---|---|
| `model_id` | 模型 ID，传给 `chat/run` 的 `model_id` |
| `model_type` | `llm`（含主模型）/ `embedding` / `tts` / `stt` |
| `connect_status` | 小写枚举：`not_detected` / `detecting` / `available` / `unavailable` |
| `max_tokens` 等 | 容量信息，可为 null |

**对话可选模型范围**：`chat/run` 的 `model_id` 应选 `model_type=llm` 且 `connect_status=available` 的模型。`embedding`/`tts`/`stt` 是平台内部能力模型，传给对话会失败。前端选择器应按 `model_type=='llm'` 过滤后再展示。

### 3.5 其余通用接口要点

- **停止对话** `GET /chat/stop/{conversation_id}`：可带 `?meta_data=<JSON字符串>`（非法 JSON 静默忽略）。成功返回 `{"message": "successfully stopped agent run for user_id xxx, run_id N", "data": N, "requestId": ...}`；无进行中的运行时返回 no instance 类消息（仍 200）。
- **附件上传** `POST /chat/attachments/upload`：multipart，字段名 `files`（可多值）。成功 200，`data.files[]` 每项含 `object_name`（回传给 `chat/run.attachments` 用这个，不是 url）、`name`、`type`（image/file）、`size`、`presigned_url`；`summary` 含 `total/uploaded/failed`。空文件列表或全部失败 → 400。
- **Agent 详情** `GET /agents/{agent_name}`：未发布/不存在 → 404。
- **Agent 知识库** `GET /agents/{agent_name}/knowledge-bases`：同时挂本地与 AIDP 知识库 → 409。
- **文件代理** `GET /file/fetch?presigned_url=<URL编码的预签名URL>`：**无需鉴权**。MinIO 仅容器网络可达，此接口供外部（如 MCP 工具）取文件；scheme 必须 http/https，MinIO 侧失败 → 502，超时 → 504。文件名从 `Content-Disposition` / URL 路径解析。

---

## 4. `/nb/v1/knowledge` 知识库接口

> **双重限制**：除 Bearer 鉴权外，全部 9 个接口额外要求调用方属于**资产管理员租户**（`ASSET_OWNER_TENANT_ID`），否则 `403 This endpoint is restricted to asset administrators.`。普通租户 key 调用会被拒。

### 4.1 接口清单

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | `/indices?pattern=*` | 索引列表（模式匹配） |
| 2 | POST | `/indices/{index_name}?embedding_dim=N` | 创建索引/知识库 |
| 3 | DELETE | `/indices/{index_name}` | 删除索引 |
| 4 | GET | `/indices/{index_name}/files` | 索引内文件列表 |
| 5 | POST | `/indices/{index_name}/chunks?page=1&page_size=10&document=` | 分页查切片 |
| 6 | POST | `/indices/search/hybrid` | 混合检索 |
| 7 | DELETE | `/indices/{index_name}/documents` | 删除文档 |
| 8 | POST | `/file/upload` | 上传文件并触发解析入库 |
| 9 | GET | `/file/download/{object_name}` | 下载文件 |

### 4.2 创建索引

`POST /nb/v1/knowledge/indices/{index_name}`，`embedding_dim` 走 **Query**，其余走 Body：

| 字段 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `index_name` | Path | string | ✓ | 知识库名 |
| `embedding_dim` | Query | int | 否 | 向量维度 |
| `embedding_model_id` | Body | int | **是** | 向量模型 ID（必须整数，传布尔/字符串 → 422） |
| `ingroup_permission` | Body | string | 否 | 组内权限 |
| `group_ids` | Body | list | 否 | 授权组 |
| `preserve_source_file` | Body | bool | 否 | 是否保留源文件 |

### 4.3 混合检索（最常用）

`POST /nb/v1/knowledge/indices/search/hybrid`，Body（`HybridSearchRequest`）：

| 字段 | 类型 | 必填 | 约束 | 默认 | 说明 |
|---|---|---|---|---|---|
| `query` | string | ✓ | 非空 | — | 检索文本 |
| `index_names` | list | ✓ | ≥1 项 | — | 索引名列表（可传知识库名，服务端自动解析） |
| `top_k` | int | 否 | 1–100 | 10 | 返回条数 |
| `weight_accurate` | float | 否 | 0.0–1.0 | 不传走服务端默认（0.5） | 精确检索得分权重，语义权重 = 1 − 该值 |

```bash
curl -X POST "http://<host>:30013/nb/v1/knowledge/indices/search/hybrid" \
  -H "Authorization: Bearer <资产租户access_key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "报销流程", "index_names": ["faq-index"], "top_k": 5, "weight_accurate": 0.3}'
```

特殊错误：知识库未配 embedding 模型 → `409`，detail 为结构体 `{"error_type": "KNOWLEDGE_BASE_NEEDS_MODEL_CONFIG", "index_name": "...", "message": "...", "suggestion": "..."}`。

### 4.4 文件上传

`POST /nb/v1/knowledge/file/upload`，multipart：

- `file`：文件字段，**可多值**（字段名必须是 `file`）
- `index_name`：Form 字段，目标知识库

行为：文件落 MinIO → 以 `chunking_strategy=basic` 触发解析入库 → `201`，返回 `{"message": "Files uploaded and processing triggered successfully", "uploaded_filenames": [], "uploaded_file_paths": [], "errors": [], "process_tasks": ...}`。解析服务失败 → 500（detail 带 message）。

---

## 5. `/nb/a2a` A2A 协议接口

> 这是唯一有官方文档的部分（`doc/docs/zh/user-guide/agent-development/agent-configuration.md`）。A2A 适合"把 Nexent Agent 暴露为标准 Agent 端点给第三方 Agent 平台纳管"的场景；普通系统集成用 `/nb/v1` 更直接。

### 5.1 接口清单

`endpoint_id` 为发布 A2A 时分配的端点标识。

| # | 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|---|
| 1 | GET | `/nb/a2a/{endpoint_id}/.well-known/agent-card.json` | **无**（公开发现） | Agent Card；支持 `If-None-Match`/ETag 协商缓存（304），`Cache-Control: max-age=3600` |
| 2 | POST | `/nb/a2a/{endpoint_id}/v1` | ✓ | JSON-RPC 2.0 统一入口 |
| 3 | POST | `/nb/a2a/{endpoint_id}/message:send` | ✓ | REST 同步发送 |
| 4 | POST | `/nb/a2a/{endpoint_id}/message:stream` | ✓ | REST 流式（SSE） |
| 5 | GET | `/nb/a2a/{endpoint_id}/tasks/{task_id}` | ✓ | 任务详情（返回任务状态与最终结果 artifact；`historyLength` 查询参数当前版本未生效，响应不含历史消息） |

JSON-RPC 支持 method：`SendMessage`（同步）、`SendStreamingMessage`（SSE）、`GetTask`。JSON-RPC 错误码：`-32601` method/endpoint 不存在、`-32001` task 不存在、`-32004` 不支持操作、`-32603` 内部错误。HTTP 层错误：404 endpoint 不存在（无鉴权也会 404，先查 endpoint 再谈鉴权）、503 Agent 未启用。

### 5.2 消息格式

用户输入取自 **`message.parts[0].text`**（只取第一个 part）；角色 `ROLE_USER`；`message` 内可带 `taskId`（仅用于任务台账定位：任务须存在且非终态才被接受）、`contextId`、`messageId`、`metadata`。多轮历史放在**与 `message` 平级的 `history` 字段**（REST 在 body 顶层、JSON-RPC 在 `params` 层；nexent 私有扩展，非 A2A 标准字段，Swagger Schema 不展示）：客户端回传历轮问答数组，服务端据此注入模型上下文，**只认 user→assistant 成对轮次**（每条同样只取 `parts[0].text`）。注意 Task 对象（响应侧）虽有标准 `history` 字段，本版本不填充。

```bash
curl -X POST "http://<host>:30013/nb/a2a/<endpoint_id>/message:stream" \
  -H "Authorization: Bearer <access_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "role": "ROLE_USER",
      "parts": [{"text": "你好，介绍一下你自己"}],
      "taskId": "task-abc-001",
      "contextId": "ctx-001",
      "messageId": "msg-001"
    }
  }'
```

### 5.3 流式事件序列（message:stream / SendStreamingMessage）

SSE 每条 `data: {json}\n\n`，标准序列：

```
data: {"task": {"id": "...", "status": {"state": "TASK_STATE_WORKING"}}}          ← 开流
data: {"artifactUpdate": {"taskId": "...", "contextId": "...",
       "artifact": {"parts": [{"data": {<agent事件JSON>}, "mediaType": "application/json"}]},
       "append": true, "lastChunk": false}}                                       ← 增量（多条）
data: {"artifactUpdate": {"taskId": "...", "artifact": {"parts": []},
       "append": true, "lastChunk": true}}                                        ← 增量结束
data: {"statusUpdate": {"taskId": "...", "contextId": "...",
       "status": {"state": "TASK_STATE_COMPLETED", "timestamp": "...Z"}}}         ← 终态
```

- artifact part 的 `data` 内为 Agent 运行事件（`model_output_thinking` / `model_output` / `tool` / `execution_logs` / `final_answer` 等，与 `/chat/run` 同源，事件语义同 §3.2.1）。
- 任务态：`TASK_STATE_WORKING` → `TASK_STATE_COMPLETED` / `TASK_STATE_FAILED` / `TASK_STATE_CANCELED`（另有 `INPUT_REQUIRED`、`REJECTED`、`AUTH_REQUIRED` 状态映射）。**与 `/chat/run` 不同，A2A 流以 `statusUpdate` 终态事件为可靠结束信号**（流内部异常也有 FAILED 终态兜底）。
- **续聊（重要，勿踩坑）**：同 `taskId` **不能**延续上下文——每轮结束任务即被置为终态（`TASK_STATE_COMPLETED`），下一轮再传同一 `taskId` 会被拒绝（JSON-RPC `-32004`；REST `message:send` 返回 HTTP 500），且服务端不会按 `taskId` 自动回放历史。A2A 通道的多轮正确姿势是**客户端自管历史**：每轮把历次问答放进请求 `history` 数组回传（`ROLE_USER`/`ROLE_AGENT` 映射为 user/assistant），服务端据此注入模型上下文并另开新任务记账。注意 history **只认 user→assistant 成对轮次**：只回传问题没回传对应答案的孤轮会被整条丢弃；每条只取 `parts[0].text`，附件不随历史回传。需要服务端记住上下文的多轮场景请走 `/nb/v1/chat/run` 的 `conversation_id` 机制（见 §3.2）。
- **与 A2A 1.0.0 规范的对照**：规范无"终态后禁用 taskId"明文；其实际立场为——① Task Immutability：终态任务不可重启，续做须在同 `contextId` 内开新任务（可用 `referenceTaskIds` 引用旧任务）；② 同 `taskId` 续用的唯一规范场景是 `INPUT_REQUIRED`/`AUTH_REQUIRED` 中断态恢复（补输入后回 WORKING）；③ 会话上下文关联是 `contextId` 的职责（"an A2A agent uses the contextId to manage its internal conversational state or its LLM context"），`taskId` 语义是继续特定工作单元。nexent 对终态同 `taskId` 返回错误是与 Task Immutability 一致的实现选择（具体错误行为规范未规定）。本版本对规范的三处偏离：① 未实现服务端凭 `contextId` 恢复 LLM 上下文（contextId 仅记账回显）；② 响应侧 Task 对象的 `history` 字段与 `GetTask` 的 `historyLength` 未实现（死参数）；③ `params.history` 为 nexent 私有扩展（规范 SendMessageRequest 无此字段，`referenceTaskIds` 亦未实现）。**后果**：按规范方式做多轮（同 contextId、每轮新 taskId、依赖服务端上下文）的标准纳管平台在本版本会每轮失忆——A2A 通道对纯标准客户端实际为单轮可用，多轮须依赖对方平台支持注入非标 `history` 字段。

> **内网补丁说明**：本环境部署的 v2.5.1-all-patch 在标准事件之外，对流式每个文本 chunk 额外补发 `result.message`（TextPart，`mediaType: text/plain`）事件，思考内容包在 ```` ```json {"thinking_content":"..."} ```` 代码块中、正文为裸文本，且终态 `statusUpdate` 带 `status.message.parts=[完整 final_answer]` 兜底 —— 只解析 TextPart 的纳管平台可直接渲染。若后续换回官方原版镜像，此增强不存在。

---

## 6. 错误协议（实测为准）

### 6.1 三种错误响应体格式（并存，按错误来源区分）

| 来源 | HTTP 示例 | 响应体格式 | 实测示例 |
|---|---|---|---|
| **业务 HTTPException**（鉴权失败、资源不存在、权限拒绝、限流等大部分错误） | 401/403/404/429/502/504 | `{"message": "<描述>"}` | `401 {"message": "Invalid or missing bearer token"}` |
| **Pydantic 请求体校验**（缺必填字段、类型错误） | **422** | `{"detail": [{字段落位+原因}]}`（FastAPI 原生） | `422 {"detail": [{"type": "missing", "loc": ["body", "agent_name"], "msg": "Field required", ...}]}` |
| **AppException**（带错误码的业务错误，如 metadata 超限） | 413/422/409…按码映射 | `{"code": "010107", "message": "...", "details": {...}}` | `413 {"code": "010107", "message": "Runtime metadata exceeds the maximum allowed size.", "details": {"reason": "METADATA_TOO_LARGE"}}` |

> **对接注意**：错误解析要同时兼容 `message`、`detail` 两种键。`detail` 可能是字符串（部分透传场景）也可能是数组（Pydantic 校验），取值时需判型。

### 6.2 状态码总表

| HTTP | 场景 |
|---|---|
| 400 | tool_params 未知参数；user_id/email 二选一违规；附件上传无有效文件；file/fetch URL scheme 非法 |
| 401 | Bearer key 缺失/无效（`{"message": ...}`） |
| 403 | 无权限（PermissionError / 知识库非资产租户 / API key 管理非管理员） |
| 404 | 会话/Agent/索引/endpoint/task 不存在 |
| 409 | 知识库缺 embedding 模型（`KNOWLEDGE_BASE_NEEDS_MODEL_CONFIG`）；Agent 同时挂本地与 AIDP 知识库 |
| **413** | `metadata` 超 64KB（`CHAT_METADATA_TOO_LARGE`，code `010107`） |
| **422** | 请求体缺必填/类型不符（Pydantic）；`metadata` 结构非法（`CHAT_METADATA_INVALID`，code `010106`） |
| 429 | 租户限流超限；幂等并发重复（注意 §3.2 幂等的真实覆盖范围） |
| 500 | 服务端内部错误（`{"message": "Internal Server Error"}`，具体看服务日志） |
| 502 | 上游（runtime/MinIO）不可达或失败（`RuntimeServiceUnavailableError`、file/fetch 代理失败） |
| 503 | A2A Agent 未启用（`AgentNotEnabledError`） |
| 504 | 上游超时（`RuntimeServiceTimeoutError`、file/fetch 超时） |

成功响应统一为 `{"message": "success", "requestId": "...", "data": ...}` 信封（API key 三个管理接口同构）。

### 6.3 重试规则

| 状态码 | 可否重试 | 说明 |
|---|---|---|
| 429 | 退避重试 | 按 `Retry-After`/指数退避；限流是租户级 |
| 502/504 | 可重试 | **但注意：`chat/run` 拿到 502/504 时用户消息可能已落库、会话可能已创建**。盲目自动重发会在新会话里重复提问。重试前先查 `/conversations` 确认状态；多轮场景务必带 `conversation_id` 重试 |
| 400/401/403/404/413/422 | 不可重试 | 请求本身的问题，重试无意义，修请求 |

### 6.4 修订记录

- 2026-09-08（v2）：按接入方 review 修订——错误协议三格式并存（§6.1）；413/422 修正（原写 400）；幂等语义改为「仅防启动瞬间并发重复」（§3.2）；SSE 生命周期与结束判定规则（§3.2.1，`final_answer` 可无 `agent_finish`、200 流中可含 `error`）；补会话/历史/模型接口完整返回示例与字段表（§3.3/§3.4）；models 改为脱敏投影并说明可选模型范围；Agent Card 免鉴权标注（§2.1/§5.1）。**同批后端修复**：`chat/run` 的 `AppException` 被 500 兜底吞掉（改为直通全局 handler，`northbound_app.py`）；`/nb/v1/models` 原样返回 `api_key`/`base_url`（改为白名单投影，`northbound_service.py`）。两处修复需随补丁包发布，旧镜像上 413/422 仍表现为 500、models 仍泄凭据。

---

## 7. 对接建议

1. **拿 key**：找租户管理员调 `/api-users/batch` 发一把专用 key（不要共用页面账号的会话 token，那是 JWT，北向不认）。
2. **普通集成走 `/nb/v1/chat/run`**：先 `GET /agents` 确认目标 Agent 已发布；多轮就复用 `conversation_id`；需要挂文件先走附件上传（回传 `object_name`）。SSE 消费遵循 §3.2.1：增量事件追加渲染、`final_answer` 整体替换、以「`agent_finish` 或流 EOF 先到」结束，`error` 事件按失败降级。
3. **防重自己做**：幂等锁只防启动瞬间重复（§3.2），按钮置灰/请求队列等客户端防抖必须有。
4. **被第三方 Agent 平台纳管走 `/nb/a2a`**：给对方 Agent Card URL（公开可访问），让对方按 A2A 1.0 对接；A2A 通道多轮由客户端自管——每轮回传 `history` 数组，**不要**复用已完成的 `taskId`（会被终态拦截，见 §5.3）。
5. **知识库管理仅限资产租户 key**；检索接口 `search/hybrid` 是给子系统查知识最省事的入口。
6. **重试遵循 §6.3**：429/502/504 可退避重试但注意消息落库副作用；4xx 不重试。
7. **抓不准参数时**，直接开 `http://<host>:30013/docs`，Schema 即源码真实定义。
