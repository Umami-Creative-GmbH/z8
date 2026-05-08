import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { parseGitHubPackageEvent } from "./github-event.js";
import { KubernetesAdapter } from "./kubernetes.js";
import { Reconciler } from "./reconciler.js";
import { RegistryClient } from "./registry.js";
import { verifyGitHubSignature } from "./signature.js";
import { StateStore } from "./state.js";

const maxBodyBytes = 1024 * 1024;

function send(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
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

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(request);
    } catch {
      send(response, 400, "invalid request body");
      return;
    }

    const signature = request.headers["x-hub-signature-256"];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
    if (!verifyGitHubSignature(rawBody, signatureHeader, config.githubWebhookSecret)) {
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

    send(response, 202, "accepted");
    void reconciler.reconcile(observation).catch((error) => {
      console.error("Deploy webhook reconciliation failed", error);
    });
  });

  server.listen(config.port, () => {
    console.log(`Deploy webhook listening on port ${config.port}`);
  });
}

startServer();
