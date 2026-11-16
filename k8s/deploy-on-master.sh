#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NAMESPACE=${NAMESPACE:-nexent}
MANIFEST=${MANIFEST:-$SCRIPT_DIR/k8s-luoshan-ui.yaml}
IMAGE_TAR=${IMAGE_TAR:-$(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'luoshan-nexent-ui-v*.tar.gz' -print | sort -r | head -n 1)}
NODE_IP=${NODE_IP:-127.0.0.1}
NODE_PORT=${NODE_PORT:-30180}

for command in kubectl ctr gzip curl; do
  command -v "$command" >/dev/null || {
    echo "缺少命令: $command" >&2
    exit 1
  }
done

[[ -f "$MANIFEST" ]] || {
  echo "找不到部署清单: $MANIFEST" >&2
  exit 1
}
[[ -n "$IMAGE_TAR" && -f "$IMAGE_TAR" ]] || {
  echo "找不到镜像包。请设置 IMAGE_TAR，或把 luoshan-nexent-ui-v*.tar.gz 放入 k8s/。" >&2
  exit 1
}

if [[ -z "${NEXENT_API_KEY:-}" ]]; then
  [[ -t 0 ]] || {
    echo "非交互执行时必须通过 NEXENT_API_KEY 环境变量提供北向密钥。" >&2
    exit 1
  }
  read -r -s -p "请输入 Nexent 北向 access_key: " NEXENT_API_KEY
  echo
fi
[[ -n "$NEXENT_API_KEY" ]] || {
  echo "北向 access_key 不能为空。" >&2
  exit 1
}

SECRET_DIR=$(mktemp -d "${TMPDIR:-/tmp}/luoshan-ui-secret.XXXXXX")
chmod 700 "$SECRET_DIR"
cleanup() {
  unset NEXENT_API_KEY NEXENT_USER_TOKEN
  rm -f "$SECRET_DIR/NEXENT_API_KEY" "$SECRET_DIR/NEXENT_USER_TOKEN"
  rmdir "$SECRET_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s' "$NEXENT_API_KEY" >"$SECRET_DIR/NEXENT_API_KEY"
printf '%s' "${NEXENT_USER_TOKEN:-}" >"$SECRET_DIR/NEXENT_USER_TOKEN"
chmod 600 "$SECRET_DIR/NEXENT_API_KEY" "$SECRET_DIR/NEXENT_USER_TOKEN"
unset NEXENT_API_KEY NEXENT_USER_TOKEN

IMAGE_FILE=$(basename "$IMAGE_TAR")
IMAGE_TAG=${IMAGE_FILE#luoshan-nexent-ui-v}
IMAGE_TAG=${IMAGE_TAG%.tar.gz}
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "无法从镜像包文件名解析安全的 tag: $IMAGE_FILE" >&2
  exit 1
}
IMAGE="luoshan-nexent-ui:v$IMAGE_TAG"

echo "[1/5] 导入镜像 $IMAGE"
gzip -dc "$IMAGE_TAR" | ctr -n k8s.io images import -

echo "[2/5] 更新 Kubernetes Secret"
kubectl create secret generic luoshan-ui-secret \
  --namespace "$NAMESPACE" \
  --from-file=NEXENT_API_KEY="$SECRET_DIR/NEXENT_API_KEY" \
  --from-file=NEXENT_USER_TOKEN="$SECRET_DIR/NEXENT_USER_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[3/5] 应用部署清单"
kubectl apply -f "$MANIFEST"
kubectl set image deployment/luoshan-ui "luoshan-ui=$IMAGE" --namespace "$NAMESPACE"

if [[ -n "${NODE_NAME:-}" ]]; then
  echo "固定到节点 $NODE_NAME"
  kubectl patch deployment luoshan-ui --namespace "$NAMESPACE" --type merge \
    -p "{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":{\"kubernetes.io/hostname\":\"$NODE_NAME\"}}}}}"
fi

echo "[4/5] 等待部署就绪"
kubectl rollout status deployment/luoshan-ui --namespace "$NAMESPACE" --timeout=180s

echo "[5/5] 验证页面与代理配置"
curl --fail --silent --show-error "http://$NODE_IP:$NODE_PORT/" >/dev/null
curl --fail --silent --show-error "http://$NODE_IP:$NODE_PORT/api/config"
echo
curl --fail --silent --show-error "http://$NODE_IP:$NODE_PORT/nb/v1/health"
echo
echo "部署完成: http://$NODE_IP:$NODE_PORT/"
