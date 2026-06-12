# Notify Server Implementation Plan

> **Superseded:** This implementation plan is superseded by `docs/superpowers/specs/2026-06-12-polling-notifications-design.md` and should not be executed unless realtime in-app notification delivery is reapproved in a new spec.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate Bun-first `apps/notify-server` service that serves notification SSE streams outside the Next.js webapp runtime.

**Architecture:** Add a focused TypeScript workspace app with pure SSE helpers, a process-local client registry, Better Auth-backed stream validation, shared Redis fanout, Bun and Node entrypoints, and same-origin Caddy routing. The browser continues using `EventSource("/api/notifications/stream")`, while production proxying sends that path to `notify-server`.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, Bun, Node fallback, Better Auth, Drizzle, ioredis, Docker, Caddy.

---

## File Structure

- `apps/notify-server/package.json`: app scripts and dependencies.
- `apps/notify-server/tsconfig.json`: strict TypeScript config and alias to `apps/webapp/src`.
- `apps/notify-server/vitest.config.ts`: test config with `@` and `server-only` aliases.
- `apps/notify-server/src/sse.ts`: SSE frame and header helpers.
- `apps/notify-server/src/registry.ts`: active client registry and org-scoped fanout.
- `apps/notify-server/src/auth.ts`: request validation using injected Better Auth and employee dependencies.
- `apps/notify-server/src/redis-fanout.ts`: Redis channel parsing and shared subscriber startup.
- `apps/notify-server/src/server.ts`: `/health` and `/api/notifications/stream` request handling.
- `apps/notify-server/src/runtime.ts`: real webapp auth, DB, notification count, Redis, and registry wiring.
- `apps/notify-server/src/bun.ts`: Bun entrypoint.
- `apps/notify-server/src/node.ts`: Node fallback entrypoint.
- `docker/Dockerfile.notify-server`: production image.
- `deploy/compose/docker-compose.yml`: `notify-server` service.
- `deploy/compose/Caddyfile`: same-origin stream proxy.

## Task 1: Scaffold `apps/notify-server`

**Files:**
- Create: `apps/notify-server/package.json`
- Create: `apps/notify-server/tsconfig.json`
- Create: `apps/notify-server/vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Create package manifest**

Create `apps/notify-server/package.json` with:

```json
{
  "name": "notify-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/bun.ts",
    "start:bun": "bun src/bun.ts",
    "start:node": "tsx src/node.ts",
    "build": "tsc --noEmit",
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-auth": "^1.6.15",
    "drizzle-orm": "^0.45.2",
    "ioredis": "^5.11.1",
    "pg": "^8.21.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.2",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `apps/notify-server/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@/*": ["../webapp/src/*"] }
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create Vitest config**

Create `apps/notify-server/vitest.config.ts` with:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      BETTER_AUTH_SECRET: "test-secret-value-with-at-least-32-characters",
      SKIP_ENV_VALIDATION: "true",
    },
    include: ["src/**/*.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "../webapp/src"),
      "server-only": path.resolve(__dirname, "../webapp/src/test/server-only.ts"),
    },
  },
});
```

- [ ] **Step 4: Add root scripts**

In root `package.json`, add:

```json
"dev:notify-server": "turbo dev --filter=notify-server",
"build:notify-server": "turbo build --filter=notify-server",
"docker:build:notify-server": "docker build -f docker/Dockerfile.notify-server -t z8-notify-server:latest ."
```

- [ ] **Step 5: Install and verify scaffold**

Run: `pnpm install`

Expected: exits 0 and updates `pnpm-lock.yaml`.

Run: `pnpm --filter notify-server build`

Expected: exits 0. If TypeScript reports no inputs, create an empty `apps/notify-server/src/.gitkeep`, rerun the command, and remove `.gitkeep` in Task 2 when real source files are added.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add package.json pnpm-lock.yaml apps/notify-server/package.json apps/notify-server/tsconfig.json apps/notify-server/vitest.config.ts
git commit -m "feat: scaffold notify server app"
```

## Task 2: Implement Pure SSE And Registry Units

**Files:**
- Create: `apps/notify-server/src/sse.ts`
- Create: `apps/notify-server/src/sse.test.ts`
- Create: `apps/notify-server/src/registry.ts`
- Create: `apps/notify-server/src/registry.test.ts`

- [ ] **Step 1: Write failing SSE tests**

Create `apps/notify-server/src/sse.test.ts` with tests for exact frame encoding and headers:

```ts
import { describe, expect, it } from "vitest";
import { createSseHeaders, encodeSseEvent } from "./sse";

describe("sse helpers", () => {
  it("encodes named events", () => {
    expect(encodeSseEvent("count_update", { count: 3, organizationId: "org-1" })).toBe(
      'event: count_update\ndata: {"count":3,"organizationId":"org-1"}\n\n',
    );
  });

  it("sets streaming headers", () => {
    const headers = createSseHeaders();
    expect(headers.get("Content-Type")).toBe("text/event-stream");
    expect(headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(headers.get("Connection")).toBe("keep-alive");
    expect(headers.get("X-Accel-Buffering")).toBe("no");
  });
});
```

- [ ] **Step 2: Verify SSE tests fail**

Run: `pnpm --filter notify-server test -- src/sse.test.ts`

Expected: FAIL because `./sse` is missing.

- [ ] **Step 3: Implement SSE helpers**

Create `apps/notify-server/src/sse.ts`:

```ts
export function encodeSseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseHeaders(): Headers {
  return new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}
```

- [ ] **Step 4: Write failing registry tests**

Create `apps/notify-server/src/registry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ClientRegistry } from "./registry";

describe("ClientRegistry", () => {
  it("fans out only to matching user and organization", () => {
    const registry = new ClientRegistry();
    const matching = vi.fn();
    const wrongOrg = vi.fn();
    registry.add({ id: "c1", userId: "u1", organizationId: "o1", send: matching });
    registry.add({ id: "c2", userId: "u1", organizationId: "o2", send: wrongOrg });

    expect(registry.fanout("u1", "count_update", { count: 4, organizationId: "o1" })).toBe(1);
    expect(matching).toHaveBeenCalledWith("count_update", { count: 4, organizationId: "o1" });
    expect(wrongOrg).not.toHaveBeenCalled();
  });

  it("removes disconnected clients", () => {
    const registry = new ClientRegistry();
    const send = vi.fn();
    registry.add({ id: "c1", userId: "u1", organizationId: "o1", send });
    registry.remove("c1");
    expect(registry.fanout("u1", "count_update", { count: 1, organizationId: "o1" })).toBe(0);
  });
});
```

- [ ] **Step 5: Verify registry tests fail**

Run: `pnpm --filter notify-server test -- src/registry.test.ts`

Expected: FAIL because `./registry` is missing.

- [ ] **Step 6: Implement registry**

Create `apps/notify-server/src/registry.ts`:

```ts
export type NotificationStreamEvent = "new_notification" | "count_update";

export interface RegisteredClient {
  id: string;
  userId: string;
  organizationId: string;
  send: (event: NotificationStreamEvent, data: unknown) => void;
}

export class ClientRegistry {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly byUser = new Map<string, Set<string>>();

  add(client: RegisteredClient): void {
    this.clients.set(client.id, client);
    const ids = this.byUser.get(client.userId) ?? new Set<string>();
    ids.add(client.id);
    this.byUser.set(client.userId, ids);
  }

  remove(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    const ids = this.byUser.get(client.userId);
    ids?.delete(id);
    if (ids?.size === 0) this.byUser.delete(client.userId);
  }

  fanout(userId: string, event: NotificationStreamEvent, data: unknown): number {
    const organizationId = typeof data === "object" && data && "organizationId" in data ? data.organizationId : null;
    if (typeof organizationId !== "string") return 0;
    let count = 0;
    for (const id of this.byUser.get(userId) ?? []) {
      const client = this.clients.get(id);
      if (!client || client.organizationId !== organizationId) continue;
      client.send(event, data);
      count += 1;
    }
    return count;
  }
}
```

- [ ] **Step 7: Run pure unit tests**

Run: `pnpm --filter notify-server test -- src/sse.test.ts src/registry.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit pure units**

Run:

```bash
git add apps/notify-server/src/sse.ts apps/notify-server/src/sse.test.ts apps/notify-server/src/registry.ts apps/notify-server/src/registry.test.ts
git commit -m "feat: add notify server sse fanout primitives"
```

## Task 3: Implement Auth Guard And Redis Message Parsing

**Files:**
- Create: `apps/notify-server/src/auth.ts`
- Create: `apps/notify-server/src/auth.test.ts`
- Create: `apps/notify-server/src/redis-fanout.ts`
- Create: `apps/notify-server/src/redis-fanout.test.ts`

- [ ] **Step 1: Write failing auth guard tests**

Create `apps/notify-server/src/auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { validateStreamRequest } from "./auth";

describe("validateStreamRequest", () => {
  it("rejects missing session", async () => {
    const result = await validateStreamRequest(new Headers(), { getSession: vi.fn(async () => null), findActiveEmployee: vi.fn() });
    expect(result).toEqual({ ok: false, status: 401, message: "Unauthorized" });
  });

  it("rejects missing active organization", async () => {
    const result = await validateStreamRequest(new Headers(), { getSession: vi.fn(async () => ({ user: { id: "u1" }, session: {} })), findActiveEmployee: vi.fn() });
    expect(result).toEqual({ ok: false, status: 400, message: "No active organization" });
  });

  it("accepts an active employee in the active organization", async () => {
    const result = await validateStreamRequest(new Headers(), {
      getSession: vi.fn(async () => ({ user: { id: "u1" }, session: { activeOrganizationId: "o1" } })),
      findActiveEmployee: vi.fn(async () => ({ organizationId: "o1" })),
    });
    expect(result).toEqual({ ok: true, userId: "u1", organizationId: "o1" });
  });
});
```

- [ ] **Step 2: Write failing Redis parser tests**

Create `apps/notify-server/src/redis-fanout.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleRedisMessage } from "./redis-fanout";

describe("handleRedisMessage", () => {
  it("delivers supported notification events to channel user", () => {
    const fanout = vi.fn(() => 1);
    const delivered = handleRedisMessage("notifications:u1", JSON.stringify({ event: "count_update", data: { count: 2, organizationId: "o1" } }), fanout);
    expect(delivered).toBe(1);
    expect(fanout).toHaveBeenCalledWith("u1", "count_update", { count: 2, organizationId: "o1" });
  });

  it("ignores malformed channels and unsupported events", () => {
    const fanout = vi.fn(() => 1);
    expect(handleRedisMessage("jobs:u1", "{}", fanout)).toBe(0);
    expect(handleRedisMessage("notifications:u1", JSON.stringify({ event: "heartbeat", data: {} }), fanout)).toBe(0);
    expect(fanout).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Verify tests fail**

Run: `pnpm --filter notify-server test -- src/auth.test.ts src/redis-fanout.test.ts`

Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement auth guard**

Create `apps/notify-server/src/auth.ts`:

```ts
export interface StreamSession { user?: { id: string } | null; session?: { activeOrganizationId?: string | null } | null }
export interface AuthDependencies {
  getSession: (headers: Headers) => Promise<StreamSession | null>;
  findActiveEmployee: (params: { userId: string; organizationId: string }) => Promise<{ organizationId: string } | null>;
}
export type StreamAuthResult = { ok: true; userId: string; organizationId: string } | { ok: false; status: 400 | 401; message: string };

export async function validateStreamRequest(headers: Headers, deps: AuthDependencies): Promise<StreamAuthResult> {
  const session = await deps.getSession(headers);
  if (!session?.user?.id) return { ok: false, status: 401, message: "Unauthorized" };
  const organizationId = session.session?.activeOrganizationId;
  if (!organizationId) return { ok: false, status: 400, message: "No active organization" };
  const employee = await deps.findActiveEmployee({ userId: session.user.id, organizationId });
  if (!employee) return { ok: false, status: 400, message: "No active employee record in this organization" };
  return { ok: true, userId: session.user.id, organizationId: employee.organizationId };
}
```

- [ ] **Step 5: Implement Redis fanout parsing**

Create `apps/notify-server/src/redis-fanout.ts`:

```ts
import type Redis from "ioredis";
import type { NotificationStreamEvent } from "./registry";

export type FanoutFunction = (userId: string, event: NotificationStreamEvent, data: unknown) => number;

export function handleRedisMessage(channel: string, message: string, fanout: FanoutFunction): number {
  const prefix = "notifications:";
  if (!channel.startsWith(prefix)) return 0;
  const userId = channel.slice(prefix.length);
  if (!userId) return 0;
  try {
    const parsed = JSON.parse(message) as { event?: unknown; data?: unknown };
    if (parsed.event !== "new_notification" && parsed.event !== "count_update") return 0;
    return fanout(userId, parsed.event, parsed.data);
  } catch {
    return 0;
  }
}

export async function startRedisFanout(params: { subscriber: Redis; fanout: FanoutFunction }): Promise<() => Promise<void>> {
  const onMessage = (channel: string, message: string) => handleRedisMessage(channel, message, params.fanout);
  params.subscriber.on("message", onMessage);
  await params.subscriber.psubscribe("notifications:*");
  return async () => {
    params.subscriber.off("message", onMessage);
    await params.subscriber.punsubscribe("notifications:*");
    params.subscriber.disconnect();
  };
}
```

- [ ] **Step 6: Run auth and Redis tests**

Run: `pnpm --filter notify-server test -- src/auth.test.ts src/redis-fanout.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit auth and Redis units**

Run:

```bash
git add apps/notify-server/src/auth.ts apps/notify-server/src/auth.test.ts apps/notify-server/src/redis-fanout.ts apps/notify-server/src/redis-fanout.test.ts
git commit -m "feat: add notify server auth and redis fanout"
```

## Task 4: Implement Stream Handler And Runtime Entrypoints

**Files:**
- Create: `apps/notify-server/src/server.ts`
- Create: `apps/notify-server/src/server.test.ts`
- Create: `apps/notify-server/src/runtime.ts`
- Create: `apps/notify-server/src/bun.ts`
- Create: `apps/notify-server/src/node.ts`

- [ ] **Step 1: Write failing server tests**

Create `apps/notify-server/src/server.test.ts` with health and rejection coverage:

```ts
import { describe, expect, it, vi } from "vitest";
import { createNotifyServerHandler } from "./server";

describe("createNotifyServerHandler", () => {
  it("serves health", async () => {
    const handler = createNotifyServerHandler({ validate: vi.fn(), getUnreadCount: vi.fn(), registerClient: vi.fn() });
    const response = await handler(new Request("http://local/health"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects unauthenticated streams", async () => {
    const handler = createNotifyServerHandler({ validate: vi.fn(async () => ({ ok: false, status: 401, message: "Unauthorized" })), getUnreadCount: vi.fn(), registerClient: vi.fn() });
    const response = await handler(new Request("http://local/api/notifications/stream"));
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });
});
```

- [ ] **Step 2: Verify server tests fail**

Run: `pnpm --filter notify-server test -- src/server.test.ts`

Expected: FAIL because `./server` is missing.

- [ ] **Step 3: Implement server handler**

Create `apps/notify-server/src/server.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { StreamAuthResult } from "./auth";
import { createSseHeaders, encodeSseEvent } from "./sse";

export interface NotifyServerDependencies {
  validate: (headers: Headers) => Promise<StreamAuthResult>;
  getUnreadCount: (userId: string, organizationId: string) => Promise<number>;
  registerClient: (client: { id: string; userId: string; organizationId: string; send: (event: "new_notification" | "count_update", data: unknown) => void }) => () => void;
}

export function createNotifyServerHandler(deps: NotifyServerDependencies) {
  return async function handleRequest(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return Response.json({ ok: true });
    if (pathname !== "/api/notifications/stream") return new Response("Not found", { status: 404 });

    const auth = await deps.validate(request.headers);
    if (!auth.ok) return new Response(auth.message, { status: auth.status });

    const encoder = new TextEncoder();
    const id = randomUUID();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: "new_notification" | "count_update" | "heartbeat", data: unknown) => controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        const unregister = deps.registerClient({ id, userId: auth.userId, organizationId: auth.organizationId, send });
        const heartbeat = setInterval(() => send("heartbeat", { timestamp: Date.now() }), 30_000);
        cleanup = () => { clearInterval(heartbeat); unregister(); };
        const count = await deps.getUnreadCount(auth.userId, auth.organizationId);
        send("count_update", { count, organizationId: auth.organizationId });
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: createSseHeaders() });
  };
}
```

- [ ] **Step 4: Add runtime wiring**

Create `apps/notify-server/src/runtime.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications/notification-service";
import { createRedisSubscriber } from "@/lib/redis";
import { validateStreamRequest } from "./auth";
import { ClientRegistry } from "./registry";
import { startRedisFanout } from "./redis-fanout";
import { createNotifyServerHandler } from "./server";

const registry = new ClientRegistry();

export const handler = createNotifyServerHandler({
  validate: (headers) => validateStreamRequest(headers, {
    getSession: (requestHeaders) => auth.api.getSession({ headers: requestHeaders }),
    findActiveEmployee: async ({ userId, organizationId }) => {
      const [record] = await db
        .select({ organizationId: employee.organizationId })
        .from(employee)
        .where(and(eq(employee.userId, userId), eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
        .limit(1);
      return record ?? null;
    },
  }),
  getUnreadCount,
  registerClient: (client) => {
    registry.add(client);
    return () => registry.remove(client.id);
  },
});

export async function startFanout(): Promise<() => Promise<void>> {
  return startRedisFanout({
    subscriber: createRedisSubscriber(),
    fanout: (userId, event, data) => registry.fanout(userId, event, data),
  });
}
```

- [ ] **Step 5: Add Bun and Node entrypoints**

Create `apps/notify-server/src/bun.ts`:

```ts
import { handler, startFanout } from "./runtime";

const port = Number(process.env.NOTIFY_SERVER_PORT ?? 3002);
await startFanout();
Bun.serve({ port, fetch: handler });
console.log(`notify-server listening on :${port}`);
```

Create `apps/notify-server/src/node.ts`:

```ts
import { createServer } from "node:http";
import { handler, startFanout } from "./runtime";

const port = Number(process.env.NOTIFY_SERVER_PORT ?? 3002);
await startFanout();

createServer(async (incoming, outgoing) => {
  const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
  });
  const response = await handler(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    for await (const chunk of response.body) {
      outgoing.write(chunk);
    }
  }
  outgoing.end();
}).listen(port, () => {
  console.log(`notify-server node fallback listening on :${port}`);
});
```

- [ ] **Step 6: Run server tests and typecheck**

Run: `pnpm --filter notify-server test -- src/server.test.ts`

Expected: PASS.

Run: `pnpm --filter notify-server build`

Expected: PASS.

- [ ] **Step 7: Commit stream handler and runtime**

Run:

```bash
git add apps/notify-server/src/server.ts apps/notify-server/src/server.test.ts apps/notify-server/src/runtime.ts apps/notify-server/src/bun.ts apps/notify-server/src/node.ts
git commit -m "feat: wire notify server runtime"
```

## Task 5: Add Docker And Same-Origin Proxy Routing

**Files:**
- Create: `docker/Dockerfile.notify-server`
- Modify: `deploy/compose/docker-compose.yml`
- Modify: `deploy/compose/Caddyfile`
- Modify: `package.json`

- [ ] **Step 1: Add Dockerfile**

Create `docker/Dockerfile.notify-server`:

```dockerfile
# syntax=docker/dockerfile:1.4
ARG BUN_VERSION=1.3.4
ARG PNPM_VERSION=11.5.2
FROM oven/bun:${BUN_VERSION}-alpine AS notify-server

RUN apk add --no-cache ca-certificates curl nodejs npm tini
RUN npm install --global pnpm@${PNPM_VERSION}

WORKDIR /repo
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/webapp/package.json ./apps/webapp/package.json
COPY apps/notify-server/package.json ./apps/notify-server/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY apps/webapp ./apps/webapp
COPY apps/notify-server ./apps/notify-server

EXPOSE 3002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "notify-server", "start:bun"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1
```

- [ ] **Step 2: Add compose service**

In `deploy/compose/docker-compose.yml`, add this service after `webapp`:

```yaml
  notify-server:
    build:
      context: ../..
      dockerfile: docker/Dockerfile.notify-server
    restart: unless-stopped
    environment:
      POSTGRES_HOST: pgbouncer
      POSTGRES_PORT: 5432
      POSTGRES_DB: ${POSTGRES_DB:-z8}
      POSTGRES_USER: ${POSTGRES_USER:-z8}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      REDIS_HOST: ${REDIS_HOST:-valkey}
      REDIS_PORT: ${REDIS_PORT:-6379}
      REDIS_PASSWORD: ${REDIS_PASSWORD:-}
      REDIS_TLS: ${REDIS_TLS:-false}
      REDIS_CA_CERT: ${REDIS_CA_CERT:-}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:?BETTER_AUTH_URL is required}
      NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL is required}
      NOTIFY_SERVER_PORT: 3002
      NODE_ENV: production
      LOG_LEVEL: ${LOG_LEVEL:-info}
    expose:
      - "3002"
    depends_on:
      pgbouncer:
        condition: service_started
      valkey:
        condition: service_healthy
      migration:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3
```

Also add `notify-server` to the `caddy.depends_on` block:

```yaml
      notify-server:
        condition: service_started
```

- [ ] **Step 3: Route stream path through Caddy**

Modify `deploy/compose/Caddyfile` app site to proxy streams first:

```caddyfile
{$APP_DOMAIN:localhost} {
	encode zstd gzip

	handle /api/notifications/stream {
		reverse_proxy notify-server:3002
	}

	reverse_proxy webapp:3000
}
```

- [ ] **Step 4: Verify config shape**

Run: `pnpm --filter notify-server build`

Expected: PASS.

Run: `docker compose -f deploy/compose/docker-compose.yml config`

Expected: exits 0 and includes `notify-server` plus the Caddy dependency.

- [ ] **Step 5: Commit deployment wiring**

Run:

```bash
git add package.json docker/Dockerfile.notify-server deploy/compose/docker-compose.yml deploy/compose/Caddyfile
git commit -m "feat: route notification streams to notify server"
```

## Task 6: Final Verification And Cleanup

**Files:**
- Modify only files needed to fix failures from verification.

- [ ] **Step 1: Run notify-server tests**

Run: `pnpm --filter notify-server test`

Expected: PASS.

- [ ] **Step 2: Run notify-server typecheck**

Run: `pnpm --filter notify-server build`

Expected: PASS.

- [ ] **Step 3: Run existing stream route tests if the route still exists**

Run: `pnpm --filter webapp test -- src/app/api/notifications/stream/route.test.ts`

Expected: PASS if the Next route remains during rollout. If the route is removed in this branch, remove or migrate its tests in the same commit.

- [ ] **Step 4: Run compose validation**

Run: `docker compose -f deploy/compose/docker-compose.yml config`

Expected: PASS.

- [ ] **Step 5: Record compatibility result**

Run locally with infrastructure available: `pnpm --filter notify-server start:bun`

Expected: service logs `notify-server listening on :3002`, `/health` returns `200`, and an authenticated browser request through Caddy reaches the stream endpoint.

- [ ] **Step 6: Final commit for verification fixes**

If verification required fixes, commit them:

```bash
git add apps/notify-server docker/Dockerfile.notify-server deploy/compose/docker-compose.yml deploy/compose/Caddyfile package.json pnpm-lock.yaml
git commit -m "fix: stabilize notify server verification"
```

If no files changed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: runtime isolation is covered by Tasks 1, 4, and 5; same-origin proxy by Task 5; Better Auth and active organization scoping by Tasks 3 and 4; shared Redis fanout by Tasks 2 and 3; no DB polling fallback by Task 3 and final verification; health endpoint by Task 4.
- Red-flag scan: this plan avoids incomplete markers and avoids changing notification UX or notification generation.
- Type consistency: `NotificationStreamEvent`, `ClientRegistry.fanout`, `validateStreamRequest`, and `createNotifyServerHandler` signatures are introduced before runtime wiring uses them.
