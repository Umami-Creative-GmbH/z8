/**
 * #279 / T15 runtime evidence: the browser adapter end to end.
 *
 * Local contract, with a Chromium executable:
 *   Z8_TEST_CHROME_PATH=... pnpm --filter webapp test:approval-workflow-repository:integration
 * Without Z8_TEST_CHROME_PATH the suite is skipped (CI has no browser configured).
 *
 * Real Chromium runs the real `public/sw.js`, its IndexedDB store and dispatcher. A
 * local HTTP server serves those files and forwards `/api/time-entries/commands` to
 * the real route handlers, which run on the label-owned disposable PostgreSQL
 * database through the real coordinators and completed-work operations. Replaced:
 * the session, billing provisioning, notification delivery and the public-origin
 * resolver (it names the local server). The transport between browser and handler
 * can drop a response after the handler committed, to reproduce a lost reply.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Pool } from "pg";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	server: null as string | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 12,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billing/guard")>()),
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/domain/request-origin", () => ({
	resolvePublicRequestOrigin: async () => {
		if (!harness.server) throw new Error("Unknown origin");
		return harness.server;
	},
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendClockOutApprovalNotifications: async () => {},
	sendClockOutApprovedNotification: async () => {},
}));

const commands = await import("./route");
const lookupRoute = await import("./[operationId]/route");

const executablePath = process.env.Z8_TEST_CHROME_PATH;
const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" && executablePath ? describe : describe.skip;
if (integrationConfiguration.status !== "enabled" || !executablePath) {
	describe.skip("browser clock commands need PostgreSQL and Z8_TEST_CHROME_PATH", () => {
		it("requires the label-owned disposable PostgreSQL runner and a Chromium executable", () => {});
	});
}

const ids = {
	organization: "t279-browser-org",
	requesterUser: "t279-requester-user",
	peerUser: "t279-peer-user",
	requester: "f2790000-0000-4000-8000-000000000001",
	peer: "f2790000-0000-4000-8000-000000000002",
} as const;
const WORKER_FILES = [
	"/sw.js",
	"/lib/offline-queue-db.js",
	"/lib/sync-service.js",
	"/lib/clock-command-dispatch.js",
];

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("browser frozen clock commands through the real route on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });
	let browser: Browser;
	let page: Page;
	let server: Server;
	let origin: string;
	/** Reachability of the API for the browser: "up", "down" (offline) or cut after commit. */
	let network: "up" | "down" | "drop_post_response" = "up";
	let postBodies: string[] = [];

	async function readBody(request: IncomingMessage) {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks).toString("utf8");
	}

	/** Hands one browser request to the real route handler. */
	async function forward(request: IncomingMessage, response: ServerResponse, pathname: string) {
		if (network === "down") {
			request.socket.destroy();
			return;
		}
		const body = request.method === "POST" ? await readBody(request) : undefined;
		if (body !== undefined) postBodies.push(body);
		const routeRequest = new Request(`${origin}${pathname}`, { method: request.method, body });
		const answer =
			pathname === "/api/time-entries/commands"
				? request.method === "POST"
					? await commands.POST(routeRequest)
					: await commands.GET(routeRequest)
				: await lookupRoute.GET(routeRequest, {
						params: Promise.resolve({ operationId: pathname.split("/").pop()! }),
					});
		const text = await answer.text();
		if (request.method === "POST" && network === "drop_post_response") {
			// The handler has committed; the browser sees a response cut mid-body.
			response.socket?.write(
				`HTTP/1.1 ${answer.status} OK\r\nContent-Type: application/json\r\nContent-Length: ${text.length + 50}\r\n\r\n${text.slice(0, 5)}`,
			);
			response.socket?.destroy();
			return;
		}
		response.statusCode = answer.status;
		response.setHeader("Content-Type", "application/json");
		response.end(text);
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.requesterUser, ids.peerUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T279 browser', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't279-requester@example.test', $3, $3),
			 ($2, 'Peer', 't279-peer@example.test', $3, $3)`,
			[ids.requesterUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t279-member-requester', $1, $2, 'member', 'approved', $4),
			 ('t279-member-peer', $1, $3, 'member', 'approved', $4)`,
			[ids.organization, ids.requesterUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'employee', $6)`,
			[ids.requester, ids.requesterUser, ids.peer, ids.peerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.requesterUser, ids.peerUser], timestamp],
		);
		await setAdmission("active");
	}

	async function rows() {
		const { rows } = await admin.query(
			`select
			   (select coalesce(json_agg(json_build_object('id', t.id, 'type', t.type) order by t.timestamp), '[]') from time_entry t where organization_id = $1) as entries,
			   (select coalesce(json_agg(json_build_object('clockIn', t.clock_in_id, 'clockOut', t.clock_out_id, 'active', t.is_active) order by t.start_time), '[]') from work_period t where organization_id = $1) as periods,
			   (select coalesce(json_agg(json_build_object('id', t.id, 'kind', t.kind, 'writer', t.writer) order by t.id), '[]') from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows) as {
			entries: { id: string; type: string }[];
			periods: { clockIn: string; clockOut: string | null; active: boolean }[];
			receipts: { id: string; kind: string; writer: string }[];
		};
	}

	function captureRequest(kind: "clock_in" | "clock_out", operationId: string) {
		return {
			operationId,
			kind,
			admission: "delayed",
			occurredAt: new Date().toISOString(),
			timezone: "Europe/Berlin",
			context: {
				userId: ids.requesterUser,
				organizationId: ids.organization,
				employeeId: ids.requester,
				server: origin,
			},
			...(kind === "clock_in"
				? { workLocationType: "home" }
				: {
						knownWorkPeriodId: null,
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
					}),
		};
	}

	async function startWorker() {
		await page.evaluate(`(async () => {
			await navigator.serviceWorker.register('/sw.js');
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
			window.sendWorker = (data, timeout = 30000) => new Promise((resolve, reject) => {
				const channel = new MessageChannel();
				const timer = setTimeout(() => reject(new Error('worker reply timed out')), timeout);
				channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
				navigator.serviceWorker.controller.postMessage(data, [channel.port2]);
			});
		})()`);
	}

	const send = (message: unknown) =>
		page.evaluate(`sendWorker(${JSON.stringify(message)})`) as Promise<Record<string, unknown>>;
	const capture = (kind: "clock_in" | "clock_out", operationId: string) =>
		send({ type: "CAPTURE_CLOCK_COMMAND", payload: captureRequest(kind, operationId) });
	const dispatch = (operationId?: string) =>
		send({ type: "DISPATCH_CLOCK_COMMANDS", ...(operationId ? { operationId } : {}) });

	async function stored() {
		await page.addScriptTag({ url: `${origin}/lib/clock-command-dispatch.js` });
		await page.addScriptTag({ url: `${origin}/lib/offline-queue-db.js` });
		return page.evaluate("ClockCommandStore.list()") as Promise<Record<string, unknown>[]>;
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled")
			throw new Error("Browser clock command PostgreSQL is disabled");
		server = createServer(async (request, response) => {
			try {
				const pathname = new URL(request.url!, "http://localhost").pathname;
				if (WORKER_FILES.includes(pathname)) {
					response.setHeader("Content-Type", "application/javascript");
					response.end(await readFile(resolve("public", `.${pathname}`)));
				} else if (pathname === "/api/time-entries/offline-context") {
					response.setHeader("Content-Type", "application/json");
					response.end(
						JSON.stringify({ userId: harness.userId, organizationId: harness.organizationId }),
					);
				} else if (pathname.startsWith("/api/time-entries/commands")) {
					await forward(request, response, pathname);
				} else {
					response.setHeader("Content-Type", "text/html");
					response.end("<!doctype html><title>T279 browser clock commands</title>");
				}
			} catch (error) {
				response.statusCode = 500;
				response.end(String(error));
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test server port");
		origin = `http://127.0.0.1:${address.port}`;
		browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
	});

	beforeEach(async () => {
		harness.userId = ids.requesterUser;
		harness.organizationId = ids.organization;
		harness.server = origin;
		network = "up";
		postBodies = [];
		await seed();
		const context = await browser.createBrowserContext();
		page = await context.newPage();
		await page.goto(origin);
		await startWorker();
	});

	afterEach(async () => {
		await page?.browserContext().close();
	});

	afterAll(async () => {
		await browser?.close();
		await new Promise<void>((done) => server?.close(() => done()));
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("commits a clock-in captured before sending and keeps its receipt locally", async () => {
		const operationId = crypto.randomUUID();
		expect(await capture("clock_in", operationId)).toMatchObject({
			success: true,
			state: "pending",
		});
		expect(await dispatch(operationId)).toMatchObject({
			success: true,
			record: {
				state: "committed",
				receipt: { kind: "start_live_work", result: { clockInEntryId: operationId } },
			},
		});
		expect(await rows()).toEqual({
			entries: [{ id: operationId, type: "clock_in" }],
			periods: [{ clockIn: operationId, clockOut: null, active: true }],
			receipts: [{ id: operationId, kind: "start_live_work", writer: "direct_http" }],
		});
	});

	it("recovers a lost response by resending the same bytes: one entry, one receipt", async () => {
		const operationId = crypto.randomUUID();
		await capture("clock_in", operationId);
		network = "drop_post_response";
		expect(await dispatch(operationId)).toMatchObject({ record: { state: "pending" } });
		const committed = await rows();
		expect(committed.receipts).toHaveLength(1);

		network = "up";
		expect(await dispatch(operationId)).toMatchObject({ record: { state: "committed" } });
		expect(await rows()).toEqual(committed);
		expect(postBodies).toHaveLength(2);
		expect(postBodies[1]).toBe(postBodies[0]);
		expect(await stored()).toMatchObject([
			{ operationId, state: "committed", uncertain: false, attemptCount: 2 },
		]);
	});

	it("closes exactly the queued clock-in's period after an offline capture of both", async () => {
		const clockIn = crypto.randomUUID();
		const clockOut = crypto.randomUUID();
		network = "down";
		await capture("clock_in", clockIn);
		await capture("clock_out", clockOut);
		expect(await dispatch(clockOut)).toMatchObject({
			status: "offline",
			record: { state: "pending" },
		});
		expect((await rows()).entries).toEqual([]);

		network = "up";
		expect(await dispatch(clockOut)).toMatchObject({
			record: { state: "committed", receipt: { kind: "close_active_work" } },
		});
		expect(await rows()).toMatchObject({
			periods: [{ clockIn, clockOut, active: false }],
			receipts: expect.arrayContaining([
				{ id: clockIn, kind: "start_live_work", writer: "direct_http" },
				{ id: clockOut, kind: "close_active_work", writer: "direct_http" },
			]),
		});
		expect(postBodies.map((body) => JSON.parse(body).operationId)).toEqual([clockIn, clockOut]);
		expect(JSON.parse(postBodies[1]).target).toEqual({ clockInOperationId: clockIn });
	});

	it("pauses under another signed-in account without writing, then commits in the captured one", async () => {
		const operationId = crypto.randomUUID();
		await capture("clock_in", operationId);
		harness.userId = ids.peerUser;
		expect(await dispatch(operationId)).toMatchObject({
			record: {
				state: "pending",
				hold: { reason: "context_mismatch", fields: ["userId", "employeeId"] },
			},
		});
		expect(postBodies).toEqual([]);
		expect((await rows()).entries).toEqual([]);

		harness.userId = ids.requesterUser;
		expect(await dispatch(operationId)).toMatchObject({
			record: { state: "committed", hold: null },
		});
		expect((await rows()).entries).toEqual([{ id: operationId, type: "clock_in" }]);
	});

	it("holds fresh work while adoption is off and still recovers an uncertain commit by lookup", async () => {
		const committed = crypto.randomUUID();
		await capture("clock_in", committed);
		network = "drop_post_response";
		await dispatch(committed);
		network = "up";
		await setAdmission("inactive");
		// Fresh submission is unavailable: the uncertain command is looked up, not resent.
		expect(await dispatch(committed)).toMatchObject({ record: { state: "committed" } });
		expect(postBodies).toHaveLength(1);

		const fresh = crypto.randomUUID();
		await capture("clock_in", fresh);
		const before = await rows();
		expect(await dispatch(fresh)).toMatchObject({
			record: { state: "pending", hold: { reason: "not_adopted" } },
		});
		expect(postBodies).toHaveLength(1);
		expect(await rows()).toEqual(before);
	});
});
