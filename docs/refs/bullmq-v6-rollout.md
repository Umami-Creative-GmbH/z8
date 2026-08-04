# BullMQ v6 Rollout

This is a one-time destructive rollout for only the `z8-jobs` queue. It intentionally and permanently deletes all pending, delayed, active, completed, and failed `z8-jobs` data and history. Database cron definitions, schedule overrides, and execution records remain.

This procedure never flushes Redis/Valkey. Do not use `FLUSHDB`, `FLUSHALL`, wildcard key deletion, or raw Redis/Valkey deletion commands.

The Kubernetes commands below apply to the checked-in `z8` namespace and deployments. Non-Kubernetes operators must provide equivalent controls that guarantee zero web and worker processes before reset, exactly one worker for verification, and the final desired capacity without any BullMQ 5/6 overlap.

1. Pause GitOps and every other reconciler that can apply the Kubernetes manifests or alter the deployments or HPAs. Keep them paused until step 13 succeeds. Do not apply the kustomization or manifests manually during maintenance.
2. In one Bash session, enable fail-fast handling, export the exact immutable BullMQ 6 release images, verify `jq`, and create a private backup directory. Replace the image examples with digests or registry-enforced unique release tags. Abort if either value is `latest`, another mutable tag, or otherwise cannot be tied uniquely to this release.

   ```bash
   set -euo pipefail
   export WEBAPP_IMAGE='registry.example.com/z8-webapp@sha256:REPLACE_WITH_DIGEST'
   export WORKER_IMAGE='registry.example.com/z8-worker@sha256:REPLACE_WITH_DIGEST'
   command -v jq >/dev/null 2>&1
   umask 077
   HPA_BACKUP_DIR="$(mktemp -d)"
   chmod 700 -- "$HPA_BACKUP_DIR"
   ```

   Export sanitized backups of both live HPAs before deleting either one. The validation commands must succeed and confirm the expected live bounds.

   ```bash
   kubectl get hpa/z8-webapp -n z8 -o json \
     | jq 'del(.metadata.creationTimestamp, .metadata.generation, .metadata.managedFields, .metadata.resourceVersion, .metadata.uid, .status)' \
     > "$HPA_BACKUP_DIR/z8-webapp.json"
   kubectl get hpa/z8-worker -n z8 -o json \
     | jq 'del(.metadata.creationTimestamp, .metadata.generation, .metadata.managedFields, .metadata.resourceVersion, .metadata.uid, .status)' \
     > "$HPA_BACKUP_DIR/z8-worker.json"
   jq -e '.metadata.name == "z8-webapp" and .spec.minReplicas == 3 and .spec.maxReplicas == 10' \
     "$HPA_BACKUP_DIR/z8-webapp.json" >/dev/null
   jq -e '.metadata.name == "z8-worker" and .spec.minReplicas == 2 and .spec.maxReplicas == 10' \
     "$HPA_BACKUP_DIR/z8-worker.json" >/dev/null
   ```

3. Delete both HPAs and verify they are absent before scaling either deployment. Then scale both deployments to zero, wait for every matching pod to be deleted, and verify both pod queries return no resources.

   ```bash
   kubectl delete hpa/z8-webapp hpa/z8-worker -n z8
   HPA_REMAINDERS="$(
     kubectl get hpa/z8-webapp hpa/z8-worker -n z8 \
       --ignore-not-found -o name
   )"
   test -z "$HPA_REMAINDERS"
   kubectl scale deployment/z8-webapp deployment/z8-worker -n z8 --replicas=0
   kubectl wait --for=delete pod -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=webapp' \
     --timeout=300s
   kubectl wait --for=delete pod -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=worker' \
     --timeout=300s
   kubectl get pods -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=webapp'
   kubectl get pods -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=worker'
   ```

   Do not continue unless both pod queries report no resources and no BullMQ workers are running.
4. From the release environment, run a one-off container from the exact `WORKER_IMAGE` exported in step 2. Use the same production Redis credentials, TLS settings, network access, and other environment injection as the worker deployment. Substitute the real environment and network mechanism in this template:

   ```bash
   docker run --rm \
     --entrypoint tsx \
     --env-file "$PRODUCTION_WORKER_ENV_FILE" \
     --network "$PRODUCTION_WORKER_NETWORK" \
     "$WORKER_IMAGE" \
     scripts/obliterate-job-queue.ts --confirm=z8-jobs
   ```

   If the command reports the exact error `Queue "z8-jobs" was obliterated, but closing its connection failed`, deletion completed. Do not rerun it blindly: confirm all producer and consumer processes remain stopped, then continue. For any other error, abort before deployment. Do not substitute another deletion method.
5. While both deployments remain scaled to zero, set their BullMQ 6 images. This avoids the version overlap that their `maxUnavailable: 0` rolling-update strategy would otherwise allow:

   ```bash
   kubectl set image deployment/z8-webapp webapp="$WEBAPP_IMAGE" -n z8
   kubectl set image deployment/z8-worker worker="$WORKER_IMAGE" -n z8
   ```

   Non-Kubernetes operators must stage both immutable release images without starting any process.
6. Start exactly one worker, wait for it to become available, and verify exactly one ready worker pod exists:

   ```bash
   kubectl scale deployment/z8-worker -n z8 --replicas=1
   kubectl rollout status deployment/z8-worker -n z8 --timeout=300s
   kubectl get pods -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=worker' \
     -o json \
     | jq -e '(.items | length) == 1 and all(.items[]; .status.phase == "Running" and ((.status.containerStatuses // []) | length) > 0 and all(.status.containerStatuses[]; .ready == true))' \
       >/dev/null
   ```

   Non-Kubernetes operators must start exactly one worker and independently verify that no other worker or web process is running.
7. Read the one worker's startup logs:

   ```bash
   kubectl logs deployment/z8-worker -n z8 -c worker
   ```

   Find the structured `Worker started with job schedulers` log and inspect its full `jobSchedulers` array. Determine the total configured cron-job count expected to be scheduled, including schedules not represented by visible UI rows, and verify the array length equals that count. For every configured schedule, verify exactly one entry exists with `name` equal to the cron job name, `id` equal to `cron-${jobName}`, `pattern` equal to the configured pattern, and a non-null `next` time. Verify the array contains no unexpected or stale scheduler IDs. Use the platform worker queue page only as a secondary check. Halt the rollout if the count or ID set differs, any scheduler is missing or duplicated, any field differs, or `next` is null; do not start additional processes.
8. Verify the worker logs contain `Cron job scheduler reconciliation completed` with `failed: 0`.
9. Restore final capacity and wait for both deployments. Verify exactly three ready webapp pods and two ready worker pods before restoring either HPA.

   ```bash
   kubectl scale deployment/z8-webapp -n z8 --replicas=3
   kubectl scale deployment/z8-worker -n z8 --replicas=2
   kubectl rollout status deployment/z8-webapp -n z8 --timeout=300s
   kubectl rollout status deployment/z8-worker -n z8 --timeout=300s
   kubectl get pods -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=webapp' \
     -o json \
     | jq -e '(.items | length) == 3 and all(.items[]; .status.phase == "Running" and ((.status.containerStatuses // []) | length) > 0 and all(.status.containerStatuses[]; .ready == true))' \
       >/dev/null
   kubectl get pods -n z8 \
     -l 'app.kubernetes.io/name=z8,app.kubernetes.io/component=worker' \
     -o json \
     | jq -e '(.items | length) == 2 and all(.items[]; .status.phase == "Running" and ((.status.containerStatuses // []) | length) > 0 and all(.status.containerStatuses[]; .ready == true))' \
       >/dev/null
   ```

   Non-Kubernetes operators may start their remaining web and worker processes only after equivalent scheduler and reconciliation gates pass.
10. Restore both saved HPAs, verify their bounds, and remove the backup directory. Keep GitOps and other reconcilers paused.

   ```bash
   kubectl apply -f "$HPA_BACKUP_DIR/z8-webapp.json" \
     -f "$HPA_BACKUP_DIR/z8-worker.json"
   kubectl get hpa/z8-webapp hpa/z8-worker -n z8 -o json \
     | jq -e '(.items | length) == 2 and any(.items[]; .metadata.name == "z8-webapp" and .spec.minReplicas == 3 and .spec.maxReplicas == 10) and any(.items[]; .metadata.name == "z8-worker" and .spec.minReplicas == 2 and .spec.maxReplicas == 10)' \
       >/dev/null
   rm -- "$HPA_BACKUP_DIR/z8-webapp.json" "$HPA_BACKUP_DIR/z8-worker.json"
   rmdir -- "$HPA_BACKUP_DIR"
   unset HPA_BACKUP_DIR
   ```

   If the rollout halts after HPA deletion, keep GitOps paused and retain the backups. Decide the desired deployment replica state first, then deliberately restore and verify both HPAs. Do not resume GitOps or leave autoscaling silently disabled.
11. Await or trigger one low-risk cron and verify that it completes successfully.
12. During the maintenance window, restart Redis/Valkey. Then enqueue one low-risk job and verify the worker reconnects and processes it successfully.
13. Before resuming reconciliation, update the GitOps desired source to use the exact immutable `WEBAPP_IMAGE` and `WORKER_IMAGE` values exported in step 2 and the intended deployment and HPA state. Render the final GitOps manifests through the same path the reconciler uses and verify all of the following:

   - Deployment `z8-webapp`, container `webapp`: image exactly equals `$WEBAPP_IMAGE` and replicas equal `3`.
   - Deployment `z8-worker`, container `worker`: image exactly equals `$WORKER_IMAGE` and replicas equal `2`.
   - HPA `z8-webapp`: present with `minReplicas: 3` and `maxReplicas: 10`.
   - HPA `z8-worker`: present with `minReplicas: 2` and `maxReplicas: 10`.
   - Neither source nor rendered output uses `latest`, another mutable tag, or an image reference different from the already verified immutable values.

   Reconfirm the live deployment images and intended deployment/HPA state before unpausing:

   ```bash
   test "$(kubectl get deployment/z8-webapp -n z8 -o jsonpath='{.spec.template.spec.containers[?(@.name=="webapp")].image}')" = "$WEBAPP_IMAGE"
   test "$(kubectl get deployment/z8-worker -n z8 -o jsonpath='{.spec.template.spec.containers[?(@.name=="worker")].image}')" = "$WORKER_IMAGE"
   kubectl get deployment/z8-webapp deployment/z8-worker -n z8 -o json \
     | jq -e '(.items | length) == 2 and any(.items[]; .metadata.name == "z8-webapp" and .spec.replicas == 3) and any(.items[]; .metadata.name == "z8-worker" and .spec.replicas == 2)' \
       >/dev/null
   kubectl get hpa/z8-webapp hpa/z8-worker -n z8 -o json \
     | jq -e '(.items | length) == 2 and any(.items[]; .metadata.name == "z8-webapp" and .spec.minReplicas == 3 and .spec.maxReplicas == 10) and any(.items[]; .metadata.name == "z8-worker" and .spec.minReplicas == 2 and .spec.maxReplicas == 10)' \
       >/dev/null
   ```

   Resume GitOps and other reconcilers only after the desired source, rendered manifests, live state, HPA restoration, low-risk cron, and Redis/Valkey reconnect checks all succeed. If any check fails, keep reconciliation paused and correct the desired state; never allow reconciliation to reintroduce mutable images or stale replica/HPA settings.
