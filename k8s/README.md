# Kubernetes 部署模板

本目录用于把已经构建的罗山 AI 助手部署到现有 Nexent Kubernetes 集群。默认命名空间为 `nexent`，NodePort 为 `30180`，北向地址示例为 `http://10.20.6.120:30013`。应用前应按目标集群调整这些值。

仓库和镜像不包含真实北向密钥或用户 JWT。部署脚本只把运行时输入写入 `luoshan-ui-secret`，不会修改 Nexent 数据库，也不会读取集群签名密钥或自动签发 JWT。

## 构建镜像

在有 Node.js、npm 和 Docker 的构建机上执行：

```sh
cd luoshan-nexent-ui
npm ci
npm run build
docker build --platform linux/arm64 -f k8s/Dockerfile \
  -t luoshan-nexent-ui:v$(date +%Y%m%d) .
docker save luoshan-nexent-ui:v$(date +%Y%m%d) | gzip \
  > k8s/luoshan-nexent-ui-v$(date +%Y%m%d).tar.gz
```

示例使用 `linux/arm64`，应以目标集群节点架构为准。镜像包体积较大，不提交 Git。

## 配置清单

部署前检查 [k8s-luoshan-ui.yaml](k8s-luoshan-ui.yaml)：

- `metadata.namespace` 是否为目标命名空间；若修改，脚本同时设置 `NAMESPACE`。
- `NEXENT_BASE_URL` 是否能从 Pod 访问，且不追加 `/nb/v1`。
- `NEXENT_AGENT_NAME` 是否为已发布智能体名称。
- 外部门户需要把源加入 `EMBED_ALLOWED_ORIGINS`，例如 `https://portal.example.com`。
- `nodePort: 30180` 是否可用并已按需开放防火墙。

真实定时任务或会话删除还需要填写非敏感的 `NEXENT_MAIN_API_URL`、`NEXENT_AGENT_API_URL` 和认证模式。JWT 通过 Secret 中的 `NEXENT_USER_TOKEN` 注入。

## 部署

把镜像包和本目录文件复制到能访问集群的节点。交互式执行时，脚本会静默提示输入北向密钥：

```sh
cd k8s
./deploy-on-master.sh
```

需要真实定时任务时，可先静默读取用户 JWT，再运行脚本，避免把值写入 shell 历史：

```sh
read -r -s -p 'Nexent user JWT: ' NEXENT_USER_TOKEN
echo
export NEXENT_USER_TOKEN
./deploy-on-master.sh
unset NEXENT_USER_TOKEN
```

非交互环境可通过受保护的 CI Secret 注入 `NEXENT_API_KEY`。不要把密钥作为脚本位置参数，也不要写回清单或 ConfigMap。

可选变量：

| 变量        | 作用                                               |
| ----------- | -------------------------------------------------- |
| `IMAGE_TAR` | 指定镜像压缩包；默认取 `k8s/` 中文件名排序最后一个 |
| `NAMESPACE` | Kubernetes 命名空间，默认 `nexent`                 |
| `NODE_NAME` | 可选，将 Pod 固定到已导入镜像的节点                |
| `NODE_IP`   | 部署后验证使用的节点地址，默认 `127.0.0.1`         |
| `NODE_PORT` | 部署后验证使用的端口，默认 `30180`                 |

如果没有镜像仓库，镜像必须导入可能调度该 Pod 的每个节点，或通过 `NODE_NAME` 固定到已导入镜像的节点。

## 验证与更新

```sh
kubectl -n nexent get deploy,pod,svc -l app=luoshan-ui
kubectl -n nexent logs deployment/luoshan-ui
curl -sS http://10.20.6.120:30180/api/config
curl -sS http://10.20.6.120:30180/nb/v1/health
```

配置接口应显示 `configured: true`，但不应返回密钥。更新时用新日期 tag 重新构建镜像包，再运行脚本；脚本会导入镜像、更新 Secret、设置 Deployment 镜像并等待滚动完成。

正式门户的小窗地址为 `http(s)://前端服务地址:30180/embed/?chrome=0`。生产环境建议在 NodePort 前增加带登录控制的 HTTPS 网关，关闭 SSE 缓冲和缓存。裸机 Node 部署见[根目录部署说明](../部署说明.md)。
