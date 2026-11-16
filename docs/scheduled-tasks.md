# 定时任务：提案与确认

2026-09-18。前端保留北向对话接口，定时任务独立接入 Nexent 主 API；不修改北向 enable_automation_tool=False，不自动确认提案。

## 页面入口

PC 左侧「定时任务」，侧栏折叠后工具栏仍保留入口；手机在历史抽屉内打开。同一窗口有「服务端任务」与「本地演示」两个明确分开的模式。聊天输入框草稿可带入新任务内容，但不会自动提交。

服务端流程：填写名称、任务内容、智能体 ID 和时间 → 生成提案 → 展示服务端整理后的内容、执行计划、时区、起止时间及次数上限（如返回）→ 用户点击「确认并启用任务」→ 显示服务端返回状态并刷新列表。支持列表分页、暂停、恢复和删除二次确认。当前不提供立即执行按钮。

本地演示同样先生成待确认提案，再由用户确认保存；支持每天、每周多日、仅一次，编辑、暂停、删除与浏览器存储。演示没有后台调度器，不会执行任务、发送通知，也不会伪造执行成功记录。

## 配置

在服务端 .env 中追加，保存后重启前端：

```dotenv
NEXENT_MAIN_API_URL=http://主API服务器:实际端口
NEXENT_USER_TOKEN=此Nexent实例的用户登录JWT
NEXENT_AUTOMATION_AGENT_ID=此用户租户内的智能体数字ID
```

NEXENT_MAIN_API_URL 是运行主 API 的服务根地址，若使用 Nexent 网关可包含 /api 前缀。代理会保留此前缀，再拼接 /agent/automations。不要填写已经包含 /agent/automations 的完整路径。不能凭北向的 30013 端口推断主 API 也在同一端口；应先确认部署路由。目标环境需单独确认主 API 路由和身份模式。

NEXENT_USER_TOKEN 与 NEXENT_API_KEY 完全独立：前者用于主 API 用户登录鉴权，后者仅用于 /nb/v1。两者都不下发浏览器；/api/config 只返回是否配置、鉴权模式和默认智能体 ID。JWT 过期后需要更新并重启，不包含自动刷新登录流程。可省略默认智能体 ID；创建表单从后端读取已发布智能体，用户按名称选择，提交时自动使用对应 ID。

默认 NEXENT_AUTOMATION_AUTH_MODE=jwt，缺少 JWT 时不允许转发。只有已经确认后端 DEPLOYMENT_VERSION=speed（IS_SPEED_MODE=True）的开发实例，才显式使用以下配置：

```dotenv
NEXENT_MAIN_API_URL=http://127.0.0.1:5014
NEXENT_AUTOMATION_AUTH_MODE=speed
NEXENT_AUTOMATION_AGENT_ID=5
NEXENT_AGENT_API_URL=http://127.0.0.1:5010
```

NEXENT_AGENT_API_URL 为智能体配置服务根地址，与任务主 API 使用同一套用户身份；主 API 已经是同时提供运行与配置接口的网关时可留空。代理只调用 /agent/published_list，页面不传 tenant_id，也不复用北向身份查询。

上述地址与 ID 为当前本机已核实值；部署到其他环境必须重新核对。speed 模式不发送 Authorization，由 Nexent 使用其默认开发用户；不会复用北向 access_key，也不会在正常模式鉴权失败后自动降级。正常部署继续配置 jwt 和真实用户 JWT。配置仅改变前端代理如何连接既有后端，不改变 Nexent 后端鉴权设置。

这是单用户演示/接入实例，共享服务端用户凭据。部署在门户中时，仍需已有的访问控制；多用户场景应由门户 BFF 按用户映射身份。

## 接口契约

按本地 Nexent 仓库 20f9d72ae 的 backend/apps/agent_automation_app.py、services/agent_automation/models.py 与 facade.py 核对。它与早期本机北向临时运行目录并非同一代码基线；部署环境必须具备以下接口。

| 前端同源接口                                 | 上游接口                                       | 行为             |
| -------------------------------------------- | ---------------------------------------------- | ---------------- |
| POST /api/automations/proposals              | POST /agent/automations/proposals              | 建立未确认提案   |
| POST /api/automations/proposals/{id}/confirm | POST /agent/automations/proposals/{id}/confirm | 用户确认后启用   |
| GET /api/automations?page=1&page_size=20     | GET /agent/automations                         | 获取当前用户任务 |
| POST /api/automations/{id}/pause             | POST /agent/automations/{id}/pause             | 暂停             |
| POST /api/automations/{id}/resume            | POST /agent/automations/{id}/resume            | 恢复             |
| DELETE /api/automations/{id}                 | DELETE /agent/automations/{id}                 | 删除             |

创建请求示例（数字 ID 仅示例，应换成实际值）：

```json
{
  "agent_id": 7,
  "message": "创建定时任务，名称：设备巡检日报。请在北京时间每天 08:00 执行以下工作：检查设备运行状态并汇总异常。",
  "timezone": "Asia/Shanghai"
}
```

主 API 返回 {code:0,message:"success",data:{proposal_id,conversation_id,executable,task,capability_resolution}}。前端必须使用返回的 task 内容展示确认卡，不能用用户输入代替服务端解析结果。executable 不为 true、缺能力或缺计划时禁用确认。确认请求体为 {}，只在用户点击后向返回的 proposal_id 发起一次请求。创建时不复用北向 conversation_id，防止两套凭据身份不同或已有会话已绑定任务。

## 异常与边界

- 所有写请求均不自动重试；确认处理中禁用按钮及模式切换。
- 确认失败或超时可能产生不确定状态，禁用重复确认，提示刷新列表并到 Nexent 核查。不会把确认不明当作失败后自动重建。
- 提案创建可能触发模型分析、创建会话及写入记录。超时后先在 Nexent 核查，不自动重发。
- 关闭窗口再打开仍保留当前页面内的待确认提案；刷新页面后应去 Nexent 对应会话恢复处理。当前未添加未在源码中存在的提案查询/拒绝接口；「暂不确认」只停止当前确认流程，后台提案仍待确认，不会启用。
- 服务端任务状态以 API 返回为准；本地一次性任务过期仅显示「计划时间已过」，不宣称已执行。
- 本地存储失败会明确报错，多标签页变更检测避免静默覆盖。

## 验证

34 项接口/代理/时间计算单元测试、18 项 Chromium 浏览器测试、TypeScript 校验与生产构建通过。覆盖创建不自动确认、用户显式确认、能力不足禁用、不确定确认不重发、JWT 与北向密钥隔离、同源校验、网关 /api 前缀、PC/手机交互、本地持久化及错误处理。浏览器测试使用契约模拟，没有创建真实服务端任务。以上为 2026-09-18 的模拟验证记录；真机浏览器仍需部署后验证。

[PC 确认卡](previews/tasks-proposal-desktop.png) · [手机确认卡](previews/tasks-proposal-mobile.png) · [本地演示表单](previews/tasks-create-desktop.png)

## 2026-09-20 本机任务主 API 联通

排查发现旧配置未设置任务主 API 和 JWT，代理返回 503，浏览器本地演示不会向 Nexent 发送请求。已在运行中的 nexent-runtime 容器核实 IS_SPEED_MODE=True；新增显式 speed 模式，默认 jwt 行为不变，未知模式或正常模式缺凭据仍拒绝转发。

本机配置为主 API http://127.0.0.1:5014、speed 模式、罗山AI运维助手 ID 5。通过真实浏览器提交一次“前端联调验证（未启用）”提案，计划时间 2030-01-01 09:00，后端返回 HTTP 200、code=0、proposal_id=1、conversation_id=6、executable=true。未发送 confirm，任务列表仍为 0；未验证实际调度执行，也不会自动把本地演示记录上传。用户应在“服务端任务”重新生成并确认自己的计划。

38 项单元测试、4 项任务浏览器回归、TypeScript 校验和生产构建通过。新增覆盖显式免登录转发、不复用旧 JWT 或北向密钥、正常模式不降级以及同源校验。

## 按名称选择执行智能体

任务表单已移除数字 ID 输入，改为“执行智能体”名称下拉框。数据来自同一主 API 用户身份下的已发布列表；优先显示 display_name，同名时附加内部名称帮助区分，不可用项禁选。配置的默认 ID 只有在当前可用列表中才生效；未配置或失效时需用户选择。列表为空或加载失败时禁止生成提案，提供重新加载按钮。确认卡也优先显示对应名称。

新增 GET /api/automations/agents，经同源代理映射为 GET /agent/published_list；可用 NEXENT_AGENT_API_URL 指向独立配置服务。返回只包含 ID、名称、显示名称和可用状态，不暴露智能体配置或模型凭据。

验证：40 项单元测试、7 项定时任务浏览器测试及生产构建通过。实际后端读取到 5 个已发布智能体，默认显示“罗山AI运维助手”；PC 和手机均可按名称选择，手机无横向溢出。浏览器回归验证选择“巡检助手”时提交对应 ID，并覆盖空列表、不可用项、加载失败与重试；此次没有创建或启用真实任务。

## 每月、每季度与每年（2026-09-22）

PC / 手机的服务端表单和本地演示均支持以下周期，统一按北京时间执行：

| 周期 | 表单配置 | 示例规则 |
| --- | --- | --- |
| 每月 | 几日、几点 | 每月 15 日 08:30 → `30 8 15 * *` |
| 每季度 | 首月几日、几点 | 1、4、7、10 月的 15 日 08:30 → `30 8 15 1,4,7,10 *` |
| 每年 | 几月、几日、几点 | 每年 12 月 15 日 08:30 → `30 8 15 12 *` |

季度以自然季度的首月为准，不是从创建日往后每隔 90 天。每月 / 每季度选择 31 日时，没有该日期的月份跳过，不会提前到月末。年度表单校验月日组合；当前后端年度解析在非闰年不能处理 2 月 29 日，前端暂不接受年度闰日计划。演示记录新增可选 monthDay / yearMonth 字段，旧记录继续兼容。

真实模式仍调用原来的提案接口，发送明确的自然语言计划，由后端解析。确认卡和任务列表展示后端实际计划。新周期提案返回的时区、Cron、执行模式必须与表单一致，否则禁止启用并提示核查；未扩展代理的写接口，也不会自动确认或执行任务。

验证：60 项单元测试、18 项任务浏览器回归、TypeScript 与生产构建通过，覆盖 PC / 手机三种新增周期、年度保存编辑、月末跨月和季度跨年、错误计划禁止确认。已在本机运行的 Nexent 容器直接调用无副作用的规则解析及下次执行计算，核对三种 Cron 和月末跳过逻辑；没有创建或启用真实定时任务，远端服务器版本仍需核对其计划解析结果。

部署升级：保留服务器自己的 .env，替换本包 dist 与 server 并重启前端，浏览器强制刷新。保留源码时一并更新 src、tests、docs。此前“执行智能体不可选”的服务器连接问题仍需提供 `/api/automations/agents` 返回内容定位，新增周期不会改变鉴权和配置服务地址。
