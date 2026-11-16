# K8s 集群部署（罗山 nexent 集群）

把 `luoshan-nexent-ui` 容器化部署到 nexent 集群（master 10.20.6.120），宿主机不装 Node。访问入口 **http://10.20.6.120:30180/**。

本目录内容：

```
k8s/
├── deploy-on-master.sh     一键部署脚本（仅 master 执行，幂等）
├── k8s-luoshan-ui.yaml     ConfigMap + Deployment + Service(NodePort 30180)
└── Dockerfile              镜像构建文件（构建上下文 = 仓库根目录）
```

**镜像 tar 包不入 git**（体积大）。部署前先按下一节构建，把 `luoshan-nexent-ui-v<日期>.tar.gz` 放到本目录（与脚本同目录），脚本会自动取最新一个并按文件名识别 tag（也可 `IMG_TAR=` 指定）。

## 1. 构建镜像（有外网的机器上）

```bash
cd luoshan-nexent-ui            # 仓库根目录
npm ci && npm run build         # 产出 dist/（服务端零 npm 依赖，镜像里不带 node_modules）
docker build --platform linux/arm64 -f k8s/Dockerfile -t luoshan-nexent-ui:v$(date +%Y%m%d) .
docker save luoshan-nexent-ui:v$(date +%Y%m%d) | gzip > k8s/luoshan-nexent-ui-v$(date +%Y%m%d).tar.gz
```

罗山集群节点是 arm64；在 Apple Silicon Mac 上构建必须带 `--platform linux/arm64`。镜像已完成冒烟基线：静态页 200、`/api/config` configured:true、`/nb/v1/health` 与 `/nb/v1/agents` 经同源代理转发正常。

## 2. 部署（内网 master 上）

```bash
scp k8s/luoshan-nexent-ui-v*.tar.gz root@10.20.6.120:/root/luoshan-ui-deploy/
cd /root/luoshan-ui-deploy
bash deploy-on-master.sh <北向access_key>    # key 必传：用后端已有 key，不写库（推荐）
# 或 BAKED_KEY=<新key> bash deploy-on-master.sh   # 写库模式：把 key 插入 nexent 库并绑定管理员
```

脚本做五件事：`ctr` 导镜像 → 北向 key（带参=直接用不写库；`BAKED_KEY=` 环境变量=写进 nexent 库 `user_token_info_t`，幂等）→ `kubectl apply`（按 tar 包名替换镜像 tag）→ 固定 Pod 到本节点（镜像只导 master 一台；要调度到任意节点用 `--no-pin` 并在所有节点导镜像）→ 等就绪 + 验证。

## 前置确认

| 项 | 值 | 说明 |
|---|---|---|
| 北向地址 | `http://10.20.6.120:30013` | 写在 ConfigMap `NEXENT_BASE_URL` |
| access_key | 部署时传入 | 脚本自动绑定一个管理员用户；改用自有 key 时 `k8s-luoshan-ui.yaml` 和 `API_KEY=` 两处同步改 |
| Agent | `general_assistant` | 必须是集群上**已发布**的 Agent；不同名改 ConfigMap `NEXENT_AGENT_NAME` 后 `kubectl rollout restart` |

## 定时任务 / 删除会话（全自动，无需手填）

deploy 脚本第 4/6 步自动完成：

- 自动发现 runtime(5014)/config(5010) 的 NodePort → `NEXENT_MAIN_API_URL` / `NEXENT_AGENT_API_URL`
- 自动判断 `DEPLOYMENT_VERSION`：speed → 免 token；否则（如 full）读取集群 `JWT_SECRET`，现场签发 **10 年期** JWT（无 `sid` claim 跳过 CAS 会话检查）
- 自签 token 真实调 `/agent/automations` 验证 200 后才写入，失败则提示用 `--user-token <JWT>` 手动指定
- 全程不落盘、不进 git；token 只写进 ConfigMap（`kubectl -n nexent get configmap luoshan-ui-config -o yaml` 可查）

手动覆盖（环境变量）：`NODE_IP` / `MAIN_API_URL` / `AGENT_API_URL` / `AUTH_MODE` / `USER_TOKEN` / `IMG_TAR`。

## 页面入口

| 路径 | 用途 |
|---|---|
| `/` | 完整对话页面（历史会话、定时任务等完整能力） |
| `/portal-demo/` | 模拟罗山门户演示页：悬浮球点开即嵌入 `/embed/?chrome=0`；通知/日程/OA 为演示数据 |
| `/embed/` | 供**正式门户**嵌入的紧凑对话页（iframe 内容），加 `?chrome=0` 隐藏自带顶栏；不展示历史会话，关闭再开保留当前对话 |

外部门户嵌入：门户放 `<iframe src="http(s)://<本服务地址>/embed/?chrome=0">`，并在 ConfigMap `luoshan-ui-config` 配 `EMBED_ALLOWED_ORIGINS=<门户源>`（多个空格/逗号分隔，留空仅本站可嵌），改后 `kubectl -n nexent rollout restart deployment/luoshan-ui`。凭据只存本服务，门户拿不到 `access_key`。详见 [门户悬浮对话窗说明](../docs/portal-widget.md)。

## 常见问题

- **30180 打不开**：NodePort 被占（改 yaml `nodePort` 重新 apply）；或 firewalld 只放行了 30013 等旧端口（`firewall-cmd --add-port=30180/tcp --permanent && firewall-cmd --reload`）
- **右上角未连接 / 智能体为空**：`kubectl -n nexent logs deploy/luoshan-ui`；确认 Agent 已发布、key 未被删
- **401**：key 与库中不一致（重跑脚本重新写入）
- **回复不流式、最后一次性出现**：中间链路有缓冲；本前端直连 NodePort 无此环节，检查是否套了 nginx 且未关 `proxy_buffering`
- **ImagePullBackOff**：镜像没导到被调度的节点（默认钉 master；用了 `--no-pin` 就要在所有节点导镜像）

## 后续升级

Mac 上重新构建（第 1 节命令，新日期 tag）→ scp 新 tar 包到 master 同目录 → 重跑 `bash deploy-on-master.sh <key>`（自动识别最新 tar 包并滚动更新）。只改配置不改代码时：改 ConfigMap 后 `kubectl -n nexent rollout restart deployment/luoshan-ui` 即可。

裸机 Node 直跑（不经 K8s）的部署方式见仓库根 [部署说明.md](../部署说明.md)。
