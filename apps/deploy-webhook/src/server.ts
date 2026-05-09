import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { parseGitHubPackageEvent } from "./github-event.js";
import { KubernetesAdapter } from "./kubernetes.js";
import { Reconciler } from "./reconciler.js";
import { RegistryClient } from "./registry.js";
import { verifyGitHubSignature } from "./signature.js";
import { StateStore } from "./state.js";

const maxBodyBytes = 1024 * 1024;
const reconciliationRetryAttempts = 3;
const reconciliationRetryDelayMs = 1_000;

type RetryOptions = {
  attempts: number;
  delayMs: number;
  sleep: (delayMs: number) => Promise<void>;
};

type WebhookHeaderValidation =
  | { deliveryId: string; ok: true; signatureHeader: string }
  | { body: string; ok: false; statusCode: number };

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function reconcileWithRetry(
  reconcile: () => Promise<void>,
  { attempts, delayMs, sleep: sleepFn }: RetryOptions = {
    attempts: reconciliationRetryAttempts,
    delayMs: reconciliationRetryDelayMs,
    sleep
  }
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await reconcile();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleepFn(delayMs);
    }
  }
}

function send(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function validateWebhookHeaders(headers: IncomingHttpHeaders): WebhookHeaderValidation {
  if (firstHeader(headers, "x-github-event") !== "package") {
    return { body: "unsupported event", ok: false, statusCode: 400 };
  }

  const signatureHeader = firstHeader(headers, "x-hub-signature-256");
  if (!signatureHeader) return { body: "missing signature", ok: false, statusCode: 401 };

  const deliveryId = firstHeader(headers, "x-github-delivery");
  if (!deliveryId) return { body: "missing delivery id", ok: false, statusCode: 400 };

  return { deliveryId, ok: true, signatureHeader };
}

function readRawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        request.destroy(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export function startServer(): void {
  const config = loadConfig();
  const registry = new RegistryClient({
    registryHost: config.registryHost,
    owner: config.githubOwner,
    registryUsername: config.ghcrUsername,
    token: config.ghcrToken
  });
  const kube = new KubernetesAdapter({ namespace: config.namespace });
  const state = new StateStore({ namespace: config.namespace, name: config.stateConfigMapName });
  const reconciler = new Reconciler({
    registry,
    kube,
    state,
    owner: config.githubOwner,
    rolloutTimeoutMs: config.rolloutTimeoutMs,
    migrationTimeoutMs: config.migrationTimeoutMs
  });

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      send(response, 200, "ok");
      return;
    }

    if (request.method !== "POST" || request.url !== "/webhooks/github") {
      send(response, 404, "not found");
      return;
    }

    const headerValidation = validateWebhookHeaders(request.headers);
    if (!headerValidation.ok) {
      send(response, headerValidation.statusCode, headerValidation.body);
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(request);
    } catch {
      send(response, 400, "invalid request body");
      return;
    }

    if (!verifyGitHubSignature(rawBody, headerValidation.signatureHeader, config.githubWebhookSecret)) {
      send(response, 401, "invalid signature");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      send(response, 400, "invalid json");
      return;
    }

    const observation = parseGitHubPackageEvent(payload, config.githubOwner);
    if (!observation) {
      send(response, 202, "ignored");
      return;
    }

    try {
      const recorded = await reconciler.recordObservation(observation, headerValidation.deliveryId);
      if (recorded.duplicateDelivery) {
        send(response, 202, "duplicate");
        return;
      }
    } catch (error) {
      console.error("Deploy webhook observation recording failed", error);
      send(response, 500, "failed to record observation");
      return;
    }

    send(response, 202, "accepted");
    void reconcileWithRetry(() => reconciler.reconcileRecorded(observation)).catch((error) => {
      console.error("Deploy webhook reconciliation failed", error);
    });
  });

  server.listen(config.port, () => {
    console.log(`Deploy webhook listening on port ${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
