#!/bin/bash
# ============================================================
# 罗山科技园 AI 助手前端 (luoshan-nexent-ui) K8s 部署脚本 v3
# 镜像 v20261016: CanDo 能力清单文案更新; 上版新增 /portal-demo/ 门户演示页(悬浮球) + /embed/ 悬浮窗嵌入页; 小窗交互优化
# 仅在 master (10.20.6.120) 执行; 与 nexent 同 namespace(默认 nexent)
#
# 用法:
#   bash deploy-on-master.sh <北向access_key>              # 全自动(推荐)
#   bash deploy-on-master.sh <北向access_key> --no-pin     # 不固定节点(需所有节点导镜像)
#   bash deploy-on-master.sh <key> --user-token <JWT>      # 定时任务用你自己的 JWT, 不自动签发
#
# 自动化内容:
#   1. 导入镜像 (ctr)
#   2. 北向 key: 带参数=直接用已有 key 不写库; 不带参数=内置 key 写入 nexent 库
#   3. 定时任务/删除会话配置全自动:
#      - 自动发现 runtime(5014)/config(5010) 的 NodePort -> NEXENT_MAIN_API_URL / NEXENT_AGENT_API_URL
#      - 自动判断 DEPLOYMENT_VERSION: speed->免token; 否则用集群 JWT_SECRET
#        现场签发 10 年期 JWT(无 sid claim, 跳过 CAS 会话检查, 签名/过期均合法)
#      - 签发后真实调 /agent/automations 验证 200 才写入
#   4. 部署 + 固定本节点 + 等就绪 + 验证
# 环境变量可覆盖: NS / NODE_IP / MAIN_API_URL / AGENT_API_URL / AUTH_MODE / USER_TOKEN / PG_POD / PG_USER / PG_DB
# 幂等, 可重复执行
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

NS="${NS:-nexent}"
PG_USER="${PG_USER:-root}"
PG_DB="${PG_DB:-nexent}"
BAKED_KEY="${BAKED_KEY:-}"   # 公开仓不内置 key；写库模式须 BAKED_KEY=<key> 环境变量传入

# ---- 参数解析 ----
API_KEY=""; USER_TOKEN_ARG=""; PIN=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pin)     PIN=0; shift ;;
    --user-token) USER_TOKEN_ARG="$2"; shift 2 ;;
    -h|--help)    sed -n '3,20p' "$0"; exit 0 ;;
    *)            API_KEY="$1"; shift ;;
  esac
done
if [ -n "$API_KEY" ]; then SKIP_DB=1; else API_KEY="$BAKED_KEY"; SKIP_DB=0; fi
[ -n "$API_KEY" ] || { echo "错误: 缺少北向 access_key。用法: bash $0 <access_key>（用已有 key 不写库）；或 BAKED_KEY=<key> bash $0（写入 nexent 库）"; exit 1; }

command -v kubectl >/dev/null || { echo "错误: 没有 kubectl"; exit 1; }
command -v ctr     >/dev/null || { echo "错误: 没有 ctr"; exit 1; }
command -v openssl >/dev/null || { echo "错误: 没有 openssl"; exit 1; }

psql_q() { kubectl exec -n "$NS" "$PG_POD" -- psql -U "$PG_USER" -d "$PG_DB" -tA -c "$1"; }

echo "==> [1/6] 导入镜像"
# 镜像 tar 不入 git(体积大), 部署时与脚本同目录; 多个时取最新, 也可 IMG_TAR= 指定
IMG_TAR="${IMG_TAR:-$(ls -t luoshan-nexent-ui-v*.tar.gz 2>/dev/null | head -1 || true)}"
[ -n "$IMG_TAR" ] || { echo "错误: 当前目录没有 luoshan-nexent-ui-v*.tar.gz (构建见 k8s/README.md)"; exit 1; }
TAG="${IMG_TAR#luoshan-nexent-ui-v}"; TAG="${TAG%.tar.gz}"
echo "    镜像包: $IMG_TAR  ->  tag v$TAG"
gunzip -c "$IMG_TAR" | ctr -n k8s.io images import -
ctr -n k8s.io images ls | grep luoshan-nexent-ui || true

if [ "$SKIP_DB" = "1" ]; then
  echo "==> [2/6] 使用已有北向 key, 跳过写库: $API_KEY"
  PG_POD=""
else
  echo "==> [2/6] 写入北向 access_key (nexent 库)"
  PG_POD="${PG_POD:-$(kubectl get pods -n "$NS" -o name | grep -i postgres | head -1 | cut -d/ -f2 || true)}"
  [ -n "$PG_POD" ] || { echo "错误: 在 $NS 找不到 postgres pod, 用 PG_POD=<pod名> 指定"; exit 1; }
  echo "    postgres pod: $PG_POD"
  ADMIN=$(psql_q "SELECT user_id FROM nexent.user_tenant_t WHERE delete_flag='N' AND user_role ILIKE '%admin%' LIMIT 1")
  [ -n "$ADMIN" ] || ADMIN=$(psql_q "SELECT user_id FROM nexent.user_tenant_t WHERE delete_flag='N' LIMIT 1")
  [ -n "$ADMIN" ] || { echo "错误: nexent.user_tenant_t 没有用户"; exit 1; }
  echo "    绑定用户: $ADMIN"
  EXISTS=$(psql_q "SELECT count(*) FROM nexent.user_token_info_t WHERE access_key='$API_KEY'")
  if [ "$EXISTS" = "0" ]; then
    psql_q "INSERT INTO nexent.user_token_info_t (access_key, user_id, created_by, updated_by) VALUES ('$API_KEY', '$ADMIN', '$ADMIN', '$ADMIN');" >/dev/null
    echo "    已插入 key: $API_KEY"
  else
    echo "    key 已存在, 跳过"
  fi
fi

echo "==> [3/6] 部署 Deployment + Service (NodePort 30180)"
sed "s|luoshan-nexent-ui:v[0-9]\{8\}|luoshan-nexent-ui:v$TAG|" k8s-luoshan-ui.yaml | kubectl apply -f -

# ---- 定时任务/删除会话配置 ----
echo "==> [4/6] 自动配置定时任务/删除会话"
NODE_IP="${NODE_IP:-$(hostname -I 2>/dev/null | awk '{print $1}' || true)}"
PORTS=$(kubectl get svc -n "$NS" -o jsonpath='{range .items[*]}{range .spec.ports[*]}{.port}{":"}{.nodePort}{"\n"}{end}{end}')
RT_NP=$(echo "$PORTS"  | grep '^5014:' | cut -d: -f2 | grep -v '^$' | head -1 || true)
CFG_NP=$(echo "$PORTS" | grep '^5010:' | cut -d: -f2 | grep -v '^$' | head -1 || true)
MAIN_URL="${MAIN_API_URL:-}"; AGENT_URL="${AGENT_API_URL:-}"
if [ -z "$MAIN_URL" ] && [ -n "$RT_NP" ] && [ -n "$NODE_IP" ]; then MAIN_URL="http://$NODE_IP:$RT_NP"; fi
if [ -z "$AGENT_URL" ] && [ -n "$CFG_NP" ] && [ -n "$NODE_IP" ]; then AGENT_URL="http://$NODE_IP:$CFG_NP"; fi
echo "    节点IP=$NODE_IP  runtime(5014)->NodePort ${RT_NP:-未找到}  config(5010)->NodePort ${CFG_NP:-未找到}"
[ -n "$MAIN_URL" ] && echo "    NEXENT_MAIN_API_URL=$MAIN_URL"
[ -n "$AGENT_URL" ] && echo "    NEXENT_AGENT_API_URL=$AGENT_URL"

# 认证模式: 先看部署版本
DV=$(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{range .spec.template.spec.containers[*].env[?(@.name=="DEPLOYMENT_VERSION")]}{.value}{"\n"}{end}{end}' 2>/dev/null | head -1 || true)
[ -n "$DV" ] || DV=$(kubectl get deploy -n "$NS" -o yaml | grep -A1 'name: DEPLOYMENT_VERSION' | grep 'value:' | head -1 | awk '{print $NF}' || true)
AUTH_MODE="${AUTH_MODE:-}"
TOKEN="${USER_TOKEN:-${USER_TOKEN_ARG:-}}"
MINTED=0

if [ -z "$AUTH_MODE" ]; then
  if [ "$DV" = "speed" ]; then
    AUTH_MODE="speed"; TOKEN=""
    echo "    DEPLOYMENT_VERSION=speed -> 免 token 模式"
  else
    AUTH_MODE="jwt"
    echo "    DEPLOYMENT_VERSION=${DV:-未知} -> JWT 模式"
  fi
fi

if [ "$AUTH_MODE" = "jwt" ] && [ -z "$TOKEN" ]; then
  # 用集群 JWT_SECRET 现场签发 10 年期 token(sub=库里的管理员, 无 sid 跳过 CAS 会话检查)
  JWT_SECRET=$(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{range .spec.template.spec.containers[*].env[?(@.name=="JWT_SECRET")]}{.value}{"\n"}{end}{end}' | head -1 || true)
  [ -n "$JWT_SECRET" ] || JWT_SECRET=$(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{range .spec.template.spec.containers[*].env[?(@.name=="SUPABASE_JWT_SECRET")]}{.value}{"\n"}{end}{end}' | head -1 || true)
  # secretKeyRef 的情况: 从 secret 里解
  if [ -z "$JWT_SECRET" ]; then
    REF=$(kubectl get deploy -n "$NS" -o yaml | grep -B2 'JWT_SECRET' | grep -E 'secretKeyRef|valueFrom' | head -1 || true)
    SEC_NAME=$(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{range .spec.template.spec.containers[*].env[?(@.name=="JWT_SECRET")]}{.valueFrom.secretKeyRef.name}{"\n"}{end}{end}' | head -1 || true)
    if [ -n "$SEC_NAME" ]; then
      JWT_SECRET=$(kubectl get secret "$SEC_NAME" -n "$NS" -o jsonpath='{.data.JWT_SECRET}' | base64 -d || true)
    fi
  fi
  if [ -n "$JWT_SECRET" ]; then
    PG_POD="${PG_POD:-$(kubectl get pods -n "$NS" -o name | grep -i postgres | head -1 | cut -d/ -f2 || true)}"
    MINT_USER=""
    if [ -n "$PG_POD" ]; then
      MINT_USER=$(psql_q "SELECT user_id FROM nexent.user_tenant_t WHERE delete_flag='N' AND user_role ILIKE '%admin%' LIMIT 1" 2>/dev/null || true)
      [ -n "$MINT_USER" ] || MINT_USER=$(psql_q "SELECT user_id FROM nexent.user_tenant_t WHERE delete_flag='N' LIMIT 1" 2>/dev/null || true)
    fi
    if [ -n "$MINT_USER" ]; then
      b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
      NOW=$(date +%s); EXP=$((NOW + 3650*86400))
      JH=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
      JP=$(printf '{"sub":"%s","role":"authenticated","aud":"authenticated","iat":%s,"exp":%s}' "$MINT_USER" "$NOW" "$EXP" | b64url)
      JS=$(printf '%s.%s' "$JH" "$JP" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
      TOKEN="$JH.$JP.$JS"; MINTED=1
      echo "    已用集群 JWT_SECRET 为用户 $MINT_USER 签发 10 年期 token"
    else
      echo "    警告: 拿不到用户(找不到 postgres pod), 无法自动签发"
    fi
  else
    echo "    警告: 部署里找不到 JWT_SECRET/SUPABASE_JWT_SECRET, 无法自动签发"
  fi
fi

# 签发/提供的 token 先真实验证, 200 才写(找不到 NodePort 就跳过实测)
if [ "$AUTH_MODE" = "jwt" ] && [ -n "$TOKEN" ] && [ -n "$RT_NP" ]; then
  VCODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$RT_NP/agent/automations" || echo 000)
  if [ "$VCODE" = "200" ]; then
    echo "    token 实测 /agent/automations -> 200 OK"
  elif [ "$MINTED" = "1" ]; then
    echo "    错误: 自签 token 实测返回 $VCODE, 不写入(可能 secret/用户不对), 可用 --user-token 手动指定"
    TOKEN=""
  else
    echo "    警告: 你提供的 token 实测返回 $VCODE, 仍会写入, 401 时请更换"
  fi
fi

# ---- 汇总 patch ConfigMap ----
DATA="\"NEXENT_API_KEY\":\"$API_KEY\""
[ -n "$MAIN_URL" ]  && DATA="$DATA,\"NEXENT_MAIN_API_URL\":\"$MAIN_URL\""
[ -n "$AGENT_URL" ] && DATA="$DATA,\"NEXENT_AGENT_API_URL\":\"$AGENT_URL\""
DATA="$DATA,\"NEXENT_AUTOMATION_AUTH_MODE\":\"$AUTH_MODE\""
if [ "$AUTH_MODE" = "speed" ]; then
  DATA="$DATA,\"NEXENT_USER_TOKEN\":\"\""
else
  DATA="$DATA,\"NEXENT_USER_TOKEN\":\"$TOKEN\""
fi
kubectl patch configmap luoshan-ui-config -n "$NS" --type merge -p "{\"data\":{$DATA}}" >/dev/null
if [ "$AUTH_MODE" = "jwt" ] && [ -z "$TOKEN" ]; then
  echo "    ! 定时任务/删除会话未启用(缺 token); 之后可: USER_TOKEN=<JWT> bash $0 $API_KEY 补配"
else
  echo "    ConfigMap 已更新 (AUTH_MODE=$AUTH_MODE)"
fi

if [ "$PIN" = "1" ]; then
  NODE=$(hostname | tr 'A-Z' 'a-z'); NODE=${NODE%.local}
  kubectl patch deployment luoshan-ui -n "$NS" --type merge -p \
    "{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":{\"kubernetes.io/hostname\":\"$NODE\"},\"tolerations\":[{\"key\":\"node-role.kubernetes.io/control-plane\",\"operator\":\"Exists\",\"effect\":\"NoSchedule\"}]}}}}" >/dev/null
  echo "    已固定到节点 $NODE (要调度到别处用 --no-pin 并在所有节点导镜像)"
fi

echo "==> [5/6] 等待就绪"
kubectl rollout restart deployment/luoshan-ui -n "$NS"
kubectl rollout status deployment/luoshan-ui -n "$NS" --timeout=180s

echo "==> [6/6] 验证"
sleep 2
echo "--- /api/config:"; curl -s http://127.0.0.1:30180/api/config; echo
echo "--- 北向健康(经前端代理):"; curl -s http://127.0.0.1:30180/nb/v1/health; echo
echo "--- 门户演示页(悬浮球) /portal-demo/:"; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30180/portal-demo/
echo "--- 悬浮窗嵌入页 /embed/ (含 CSP 头):"; curl -sI http://127.0.0.1:30180/embed/ | grep -i content-security-policy
echo
echo "==> 完成。浏览器访问: http://10.20.6.120:30180/"
echo "    门户演示页(悬浮球交互): http://10.20.6.120:30180/portal-demo/"
echo "    门户嵌入页: http://10.20.6.120:30180/embed/  (iframe 用 ?chrome=0 隐藏自带顶栏)"
echo "    外部门户嵌入需在 ConfigMap 补 EMBED_ALLOWED_ORIGINS=<门户源>"
echo "    /api/config 里 automationConfigured:true 即定时任务可用"
