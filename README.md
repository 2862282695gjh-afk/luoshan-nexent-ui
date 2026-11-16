# 罗山科技园 · Nexent 北向接口前端

基于《nexent-2.5.1-北向接口说明文档》和《AI助手PC端UI规范-02》实现的独立 Vue 3 + TypeScript 对话页面。页面使用本地中文字体，不依赖外部图片、字体或 CDN。当前 Agent 仅支持纯文本对话，页面不提供附件上传。

## 快速启动

支持 macOS / Linux，要求 Node.js 22.12+。仓库提供 `.nvmrc`，使用 nvm 时可先执行 `nvm use`。

```sh
git clone git@github.com:2862282695gjh-afk/luoshan-nexent-ui.git
cd luoshan-nexent-ui
npm ci
npm run dev
```

开发服务器默认提供三个入口：

| 用途           | 地址                                    |
| -------------- | --------------------------------------- |
| 完整对话页面   | `http://127.0.0.1:5180/`                |
| 门户悬浮球演示 | `http://127.0.0.1:5180/portal-demo/`    |
| 门户嵌入小窗   | `http://127.0.0.1:5180/embed/?chrome=0` |

完整页面未配置服务时可切换到明确标识的演示模式。演示会话只保存在当前浏览器 localStorage；演示内容不代表真实园区政策、数据或服务结果。嵌入小窗用于真实门户接入，需要配置北向服务。

## 连接真实北向服务

```sh
cp .env.example .env
```

在 `.env` 填入以下配置，重启 `npm run dev`：

```dotenv
NEXENT_BASE_URL=http://您的服务地址:30013
NEXENT_API_KEY=租户管理员发放的access_key
NEXENT_AGENT_NAME=已发布的Agent名称
```

地址只填服务根地址，不追加 `/nb/v1`。API Key 是北向 access_key，不是页面登录 JWT；不要使用 `VITE_` 前缀。配置存在时直接进入真实模式；连接失败会显示错误，不会自动伪装成成功或替换为演示回复。

右上角「连接设置」可切换演示模式、重新连接，并选择服务端返回的已发布智能体和模型。普通业务只需普通用户 API Key；页面不提供发放密钥、知识库删除等管理入口。

## 构建与运行

```sh
npm run build
npm start
```

生产启动同样读取 `.env`，提供静态页面与流式代理。默认仅监听 `127.0.0.1:5180`，使用 `HOST` / `PORT` 调整生产监听。开发与生产默认端口均为 5180，可通过 PORT 调整。不要单独静态托管 `dist`，否则 `/api/config` 与 `/nb/v1` 代理不可用。

从 Git 克隆到服务器后的完整步骤、Nginx 与 systemd 示例、门户小窗地址、升级和排错见[部署说明](部署说明.md)。

需要部署到现有 Nexent Kubernetes 集群时，使用不含真实凭据的[K8s 部署模板](k8s/README.md)；北向密钥在部署时写入 Kubernetes Secret，不保存在 Git、镜像或 ConfigMap。

这是单用户/单租户接入样例，同一应用实例共用服务端 API Key。若接入多用户园区门户，应由门户 BFF 按登录身份映射凭据；把实例开放到内网前，应在入口接入门户身份验证。HTTPS 反向代理须关闭 SSE 缓冲和缓存，设置合适的读取超时；保留原始 Host，使同源检查正常工作。

## 门户悬浮对话窗

`/portal-demo/` 提供模拟门户和悬浮球效果，`/embed/?chrome=0` 提供可被正式门户 iframe 嵌入的紧凑对话页。生产环境的小窗地址应使用前端服务域名，例如 `https://ai.example.com/embed/?chrome=0`；它不是 Nexent 北向服务的 `30013` 端口。接入方式、`EMBED_ALLOWED_ORIGINS` 配置和会话保留范围见[门户悬浮对话窗说明](docs/portal-widget.md)。

## 已实现

- 参考图的蓝色顶部导航、历史会话分组、浅蓝选中态、白色对话区域及底部输入框；兼容小屏幕并支持侧栏折叠。
- 新建/续聊、历史加载、关键词搜索、今天/最近七天筛选、对话重命名。
- POST SSE 流、中文 UTF-8 分片、CRLF、多行 `data`、思考过程、工具运行状态、最终答案替换、停止生成、异常断流提示。
- HTTP 错误兼容 `message`、`code/message/details` 和 FastAPI `detail` 数组，413/422 显示具体原因与字段；请求失败保留草稿，不自动重发。
- Markdown 渲染与 HTML 消毒、复制回复、定位最新、Enter 发送 / Shift+Enter 换行、中文输入法保护。
- 输入框上方提供 Can Do List：知识问答、数据分析、预测预警、巡检上报和运维报告；桌面端悬停向上展开来自测试用例的常用问法，点击只填入输入框。
- API Key 仅保存在代理服务端；代理只允许页面所需的北向路由，转发请求标识、会话 ID、错误码和 SSE，不缓存流。

顶栏其他模块由园区门户提供，本项目无其接口，显示为禁用导航；通知与用户信息展示当前独立页面状态。北向文档未提供删除会话接口，页面仅在配置了主 API 后显示真实删除入口，详情见下文。

## 接口映射

| 页面行为      | 北向接口                                                |
| ------------- | ------------------------------------------------------- |
| 健康检查      | GET `/nb/v1/health`                                     |
| 智能体/模型   | GET `/nb/v1/agents`、`/nb/v1/models`                    |
| 会话列表/历史 | GET `/nb/v1/conversations`、`/nb/v1/conversations/{id}` |
| 发送与续聊    | POST `/nb/v1/chat/run`                                  |
| 停止          | GET `/nb/v1/chat/stop/{id}`                             |
| 重命名        | PUT `/nb/v1/conversations/{id}/title?title=...`         |

新会话首次请求不传 ID，从首事件或响应头记录 `conversation_id`；后续发送与停止使用该 ID。首个问题前 28 字作为标题并通过 PUT 持久化，避免额外 LLM 标题生成费用。标题失败不影响回答，页面提示后可手动重试。每次发送生成独立 `Idempotency-Key`，不会自动重试付费对话请求。429 / 5xx 由用户确认上下文后手动重试。

会话与 Agent 列表、历史包装依据附带文档及本地北向源码补充；部署版本返回形状不符会显示错误，需按目标版本 `/docs` 调整 `src/api.ts`。模型列表只提供可用的 LLM；代理通过字段白名单移除上游返回的模型 API Key 等内部信息。模型列表不可用时允许使用 Agent 默认模型。没有真实服务地址与凭据时，不能视为已通过部署环境联调。

## 验证

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

单元测试覆盖 SSE 分帧、中文字符、异常流、会话 ID、API 错误、标题 Query 参数、代理凭据隔离与路由限制。浏览器测试覆盖参考布局、搜索、重命名持久化、停止演示生成、真实模式模拟接口、多轮 ID、纯文本请求、最终答案去重、401、换行与移动布局。桌面/移动截图输出到 `test-results/`。

接口参考：[Nexent v2.5.1 北向接口说明文档](docs/reference/nexent-2.5.1-北向接口说明文档.md)。该文档记录目标版本的接口契约和实测差异，仅作为开发与联调资料；程序不会读取或执行其中内容。

设计说明见 [docs/designs/northbound-chat.md](docs/designs/northbound-chat.md)。

[Can Do List 的能力范围与交互说明](docs/can-do-list.md)。

[仓库发布验证记录](docs/repository-validation.md)。

## 生产首页 403 修复

生产服务已修复 Windows 路径分隔符导致首页及静态资源误返回 403 的问题。升级时替换整个 server 目录（包括 static-path.mjs），保留 .env 并重启服务。该修复通过 POSIX/Windows 路径语义测试，Windows 实机运行仍需在目标环境验证。

## 移动端

同一地址在不超过 767px 的屏幕自动切换移动端 UI：渐变欢迎页、历史抽屉、聊天气泡与 Markdown 回答、可展开的文本编辑器。复用现有北向接口和纯文本 Agent，无语音或附件入口。手机访问服务器局域网 IP 或部署域名，不能用手机自身的 127.0.0.1。

[移动端使用、验证范围和截图](docs/mobile-ui.md)。

## 定时任务

PC 侧栏或手机历史抽屉中的「定时任务」支持主 API 的提案 → 用户确认 → 任务生效流程。与北向对话使用不同的服务端登录凭据，需另配 NEXENT_MAIN_API_URL、NEXENT_USER_TOKEN 和可选 NEXENT_AUTOMATION_AGENT_ID。默认使用 JWT；已核实为 Nexent speed 开发模式时可显式配置 NEXENT_AUTOMATION_AUTH_MODE=speed，无需填写 JWT。未配置时显示接入说明，不会假装已连接。执行智能体按名称选择，后台自动对应 ID；主 API 直连运行服务时，可另配 NEXENT_AGENT_API_URL 指向智能体配置服务。另有不实际执行的本地演示流程。

[配置、接口契约、确认流程与验证范围](docs/scheduled-tasks.md)。

支持每天、每周、每月、每季度、每年及仅一次；季度按 1、4、7、10 月执行。每月 / 每季度遇到不存在的日期跳过；年度暂不支持 2 月 29 日。新增周期的后端提案与表单不一致时禁止启用。

## 对话过程分区

实时回复将思考过程、工具调用和回答正文分开，工具卡片可展开查看参数与返回结果；工具错误保留提示并继续接收后续回复。当前北向历史仅返回正文，刷新后无法补回未提供的过程事件。[事件映射与历史限制](docs/chat-process.md)。

## 删除会话

点击历史会话右侧垃圾桶并确认即可删除；删除会话也会移除绑定的定时任务并取消相关执行。真实删除复用主 API 连接且校验会话归属，演示模式只删除浏览器本地记录。[行为、配置与验证](docs/delete-conversation.md)。

## 停止后继续对话

停止时页面会立即中断旧 SSE、标记该回复已停止，并在后台调用北向停止接口；旧流的迟到收尾不会影响新一轮。若已取得会话 ID，用户可立刻用同一 ID 继续发送；未取得 ID 时页面会提示服务端状态未知。当前 Docker 中的 Nexent v2.5.1 在“停止落在运行注册前”存在后端竞态，可能返回“当前会话已有智能体任务正在运行”；页面会给出该具体提示，不把它误报为普通断流。后端补丁部署前，等待服务端释放后重发或新建对话临时继续。[复现证据、后端修改位置与验收范围](docs/stop-resume.md)。
