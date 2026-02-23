#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <image-tag>"
  echo "Example: $0 sha-429b302"
  exit 1
fi

TAG="$1"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

KUBECONFIG_PATH="${KUBECONFIG_PATH:-${KUBECONFIG:-$SCRIPT_DIR/tofu/z8-prod_kubeconfig.yaml}}"
NAMESPACE="${NAMESPACE:-app-prod}"
WEB_IMAGE_REPO="${WEB_IMAGE_REPO:-ghcr.io/umami-creative-gmbh/z8-webapp}"
WORKER_IMAGE_REPO="${WORKER_IMAGE_REPO:-ghcr.io/umami-creative-gmbh/z8-worker}"
MIGRATION_IMAGE_REPO="${MIGRATION_IMAGE_REPO:-ghcr.io/umami-creative-gmbh/z8-migration}"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-900s}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-600s}"

k() {
  kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
}

if ! k get namespace "$NAMESPACE" >/dev/null 2>&1; then
  echo "Namespace '$NAMESPACE' does not exist."
  exit 1
fi

if ! k -n "$NAMESPACE" get deployment web >/dev/null 2>&1; then
  echo "Creating missing web deployment"
  k apply -f "$SCRIPT_DIR/k8s/app/web-deployment.yaml"
fi

if ! k -n "$NAMESPACE" get deployment worker >/dev/null 2>&1; then
  echo "Creating missing worker deployment"
  k apply -f "$SCRIPT_DIR/k8s/app/worker-deployment.yaml"
fi

SAFE_TAG="$(printf '%s' "$TAG" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-')"
SAFE_TAG="${SAFE_TAG#-}"
SAFE_TAG="${SAFE_TAG%-}"
if [ -z "$SAFE_TAG" ]; then
  SAFE_TAG="release"
fi

JOB_NAME="drizzle-migrate-${SAFE_TAG}"
if [ "${#JOB_NAME}" -gt 63 ]; then
  JOB_NAME="${JOB_NAME:0:63}"
fi
JOB_NAME="${JOB_NAME%-}"

echo "Running migration job '$JOB_NAME' with tag '$TAG'"
k -n "$NAMESPACE" delete job "$JOB_NAME" --ignore-not-found >/dev/null 2>&1 || true

cat <<EOF | k apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      enableServiceLinks: false
      imagePullSecrets:
        - name: ghcr-credentials
      restartPolicy: Never
      containers:
        - name: migrate
          image: ${MIGRATION_IMAGE_REPO}:${TAG}
          imagePullPolicy: IfNotPresent
          workingDir: /app/apps/webapp
          command: ["node", "./scripts/migrate-with-lock.js"]
          env:
            - name: VALKEY_HOST
              value: valkey
            - name: VALKEY_PORT
              value: "6379"
            - name: DB_MIGRATION_LOCK_ID
              value: "74382643"
            - name: DRIZZLE_MIGRATE_COMMAND
              value: "pnpm exec drizzle-kit migrate --config ./drizzle.config.ts"
          envFrom:
            - secretRef:
                name: app-secrets
EOF

if ! k -n "$NAMESPACE" wait --for=condition=Complete "job/${JOB_NAME}" --timeout="$MIGRATION_TIMEOUT"; then
  echo "Migration failed. Logs:"
  k -n "$NAMESPACE" logs "job/${JOB_NAME}" || true
  exit 1
fi

echo "Migration completed"
k -n "$NAMESPACE" logs "job/${JOB_NAME}" || true

echo "Rolling out web and worker with tag '$TAG'"
k -n "$NAMESPACE" set image deployment/web web="${WEB_IMAGE_REPO}:${TAG}"
k -n "$NAMESPACE" set image deployment/worker worker="${WORKER_IMAGE_REPO}:${TAG}"
k -n "$NAMESPACE" rollout status deployment/web --timeout="$ROLLOUT_TIMEOUT"
k -n "$NAMESPACE" rollout status deployment/worker --timeout="$ROLLOUT_TIMEOUT"

echo "Release complete"
