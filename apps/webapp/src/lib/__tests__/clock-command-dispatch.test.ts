import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredRecord = Record<string, unknown> & {
	recoveryId: string;
	operationId: string;
	revision: number;
	sequence: number;
	state: string;
};

const context = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "5f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e3f",
	server: "https://z8.test",
};
const capabilities = {
	commandVersions: [2],
	kinds: ["clock_in", "clock_out"],
	submit: "available",
	lookup: "available",
	context,
};

function load() {
	const sandbox = vm.createContext({ self: {}, URL, JSON, Date, Promise, Error, AbortSignal });
	vm.runInContext(readFileSync(resolve("public/lib/clock-command-dispatch.js"), "utf8"), sandbox);
	return (sandbox.self as { ClockCommandDispatch: Dispatch }).ClockCommandDispatch;
}

type Dispatch = {
	MAX_TRANSIENT_ATTEMPTS: number;
	buildCommand(request: Record<string, unknown>, target: unknown): Record<string, unknown>;
	process(options: Record<string, unknown>): Promise<{
		status: string;
		committed: { operationId: string; userId: string; organizationId: string }[];
	}>;
};

function record(overrides: Partial<StoredRecord> & { operationId: string }): StoredRecord {
	const kind = (overrides.kind as string) ?? "clock_in";
	const command = {
		version: 2,
		operationId: overrides.operationId,
		kind,
		admission: "delayed",
		occurredAt: "2026-09-25T08:00:00.000Z",
		timezone: "Europe/Berlin",
		context,
		...(kind === "clock_in" ? { workLocationType: "office" } : {}),
	};
	return {
		format: "z8-clock-command-record-v1",
		recoveryId: `local-${overrides.operationId}`,
		revision: 1,
		sequence: 1,
		kind,
		context,
		command,
		body: JSON.stringify(command),
		dependsOn: null,
		state: "pending",
		hold: null,
		attemptCount: 0,
		uncertain: false,
		lastOutcome: null,
		receipt: null,
		...overrides,
	};
}

/** In-memory stand-in with the same revision check as the IndexedDB store. */
function memoryStore(records: StoredRecord[]) {
	const writes: { operationId: string; patch: Record<string, unknown> }[] = [];
	return {
		records,
		writes,
		list: vi.fn(async () => structuredClone(records).sort((a, b) => a.sequence - b.sequence)),
		update: vi.fn(
			async (recoveryId: string, revision: number | null, patch: Record<string, unknown>) => {
				const index = records.findIndex((item) => item.recoveryId === recoveryId);
				// null: a receipt write that must land even after a concurrent archive.
				if (revision !== null && records[index].revision !== revision) {
					throw new Error("stale revision");
				}
				records[index] = { ...records[index], ...patch, revision: records[index].revision + 1 };
				writes.push({ operationId: records[index].operationId, patch });
				return structuredClone(records[index]);
			},
		),
		prune: vi.fn(async () => 0),
	};
}

function json(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const startReceipt = (operationId: string) => ({
	kind: "start_live_work",
	result: { operationId, workPeriodId: "period-1", clockInEntryId: operationId },
});

describe("browser clock command dispatch", () => {
	let dispatch: Dispatch;
	beforeEach(() => {
		dispatch = load();
	});

	it("serializes one canonical frozen command and binds the clock-out target", () => {
		const command = dispatch.buildCommand(
			{
				operationId: "op-out",
				kind: "clock_out",
				admission: "delayed",
				occurredAt: "2026-09-25T09:00:00.000Z",
				timezone: "Europe/Berlin",
				context,
				knownWorkPeriodId: "period-1",
				project: { kind: "preserve" },
				workCategory: { kind: "clear" },
			},
			{ clockInOperationId: "op-in" },
		);
		expect(JSON.stringify(command)).toBe(
			JSON.stringify({
				version: 2,
				operationId: "op-out",
				kind: "clock_out",
				admission: "delayed",
				occurredAt: "2026-09-25T09:00:00.000Z",
				timezone: "Europe/Berlin",
				context: {
					userId: context.userId,
					organizationId: context.organizationId,
					employeeId: context.employeeId,
					server: context.server,
				},
				target: { clockInOperationId: "op-in" },
				project: { kind: "preserve" },
				workCategory: { kind: "clear" },
			}),
		);
	});

	it("persists the attempt before sending, sends the stored bytes and stores the receipt", async () => {
		const store = memoryStore([record({ operationId: "op-in" })]);
		const order: string[] = [];
		store.update.mockImplementation(async (recoveryId, _revision, patch) => {
			order.push(patch.state === "committed" ? "receipt" : "attempt");
			const index = store.records.findIndex((item) => item.recoveryId === recoveryId);
			store.records[index] = {
				...store.records[index],
				...patch,
				revision: store.records[index].revision + 1,
			};
			return structuredClone(store.records[index]);
		});
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method !== "POST") return json(200, capabilities);
			order.push("send");
			expect(url).toBe("https://z8.test/api/time-entries/commands");
			expect(init.body).toBe(store.records[0].body);
			return json(201, {
				outcome: "executed",
				operationId: "op-in",
				receipt: startReceipt("op-in"),
			});
		});
		const run = await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(order).toEqual(["attempt", "send", "receipt"]);
		expect(store.records[0]).toMatchObject({
			state: "committed",
			attemptCount: 1,
			uncertain: false,
			receipt: startReceipt("op-in"),
		});
		expect(run.committed).toEqual([
			{ operationId: "op-in", userId: "user-1", organizationId: "org-1" },
		]);
	});

	it("keeps the same command after a transport failure and resends it byte for byte", async () => {
		const store = memoryStore([record({ operationId: "op-in" })]);
		const bodies: unknown[] = [];
		let fail = true;
		const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method !== "POST") return json(200, capabilities);
			bodies.push(init.body);
			if (fail) throw new TypeError("Failed to fetch");
			return json(200, {
				outcome: "replayed",
				operationId: "op-in",
				receipt: startReceipt("op-in"),
			});
		});
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(store.records[0]).toMatchObject({ state: "pending", uncertain: true, attemptCount: 1 });
		fail = false;
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(bodies).toEqual([store.records[0].body, store.records[0].body]);
		expect(store.records[0]).toMatchObject({ state: "committed", attemptCount: 2 });
	});

	it("stops automatic attempts after bounded transient failures without dropping the record", async () => {
		const store = memoryStore([record({ operationId: "op-in" })]);
		const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === "POST"
				? json(500, { outcome: "unknown", operationId: "op-in" })
				: json(200, capabilities),
		);
		for (let run = 0; run < dispatch.MAX_TRANSIENT_ATTEMPTS + 2; run++) {
			await dispatch.process({ store, fetch, origin: "https://z8.test" });
		}
		expect(store.records[0]).toMatchObject({
			state: "exhausted",
			attemptCount: dispatch.MAX_TRANSIENT_ATTEMPTS,
			uncertain: true,
		});
		expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
			dispatch.MAX_TRANSIENT_ATTEMPTS,
		);
		fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
			init?.method === "POST"
				? json(200, { outcome: "replayed", operationId: "op-in", receipt: startReceipt("op-in") })
				: json(200, capabilities),
		);
		await dispatch.process({ store, fetch, origin: "https://z8.test", retryExhausted: true });
		expect(store.records[0]).toMatchObject({ state: "committed" });
	});

	it("pauses on a different account, organization, employee or server without sending", async () => {
		for (const field of ["userId", "organizationId", "employeeId", "server"] as const) {
			const store = memoryStore([record({ operationId: "op-in" })]);
			const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
				init?.method === "POST"
					? json(500, {})
					: json(200, { ...capabilities, context: { ...context, [field]: "other" } }),
			);
			await dispatch.process({ store, fetch, origin: "https://z8.test" });
			expect(fetch).toHaveBeenCalledOnce();
			expect(store.records[0]).toMatchObject({
				state: "pending",
				hold: { reason: "context_mismatch", fields: [field] },
				attemptCount: 0,
			});
		}
	});

	it("does not send commands whose version the server no longer offers", async () => {
		const store = memoryStore([record({ operationId: "op-in" })]);
		const fetch = vi.fn(async () => json(200, { ...capabilities, commandVersions: [3] }));
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(fetch).toHaveBeenCalledOnce();
		expect(store.records[0]).toMatchObject({
			state: "pending",
			hold: { reason: "unsupported_version" },
		});
	});

	it("holds fresh commands while submission is unavailable but recovers an uncertain one by lookup", async () => {
		const store = memoryStore([
			record({ operationId: "op-a" }),
			record({ operationId: "op-b", sequence: 2, uncertain: true, attemptCount: 1 }),
		]);
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "POST") throw new Error("must not submit");
			if (url.endsWith("/op-b")) {
				return json(200, {
					outcome: "committed",
					operationId: "op-b",
					receipt: startReceipt("op-b"),
					evidence: "standing",
				});
			}
			return json(200, { ...capabilities, submit: "unavailable" });
		});
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(store.records[0]).toMatchObject({ state: "pending", hold: { reason: "not_adopted" } });
		expect(store.records[1]).toMatchObject({ state: "committed", receipt: startReceipt("op-b") });
	});

	it("sends a dependant only after its predecessor committed and pauses it behind a blocked one", async () => {
		const clockOut = record({
			operationId: "op-out",
			kind: "clock_out",
			sequence: 2,
			dependsOn: "op-in",
		});
		const store = memoryStore([record({ operationId: "op-in" }), clockOut]);
		const sent: string[] = [];
		const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method !== "POST") return json(200, capabilities);
			const { operationId } = JSON.parse(String(init.body));
			sent.push(operationId);
			return operationId === "op-in"
				? json(409, { outcome: "rejected", operationId, code: "occupancy_conflict" })
				: json(500, {});
		});
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(sent).toEqual(["op-in"]);
		expect(store.records[0]).toMatchObject({
			state: "review_required",
			lastOutcome: { code: "occupancy_conflict" },
		});
		expect(store.records[1]).toMatchObject({
			state: "pending",
			hold: { reason: "predecessor_blocked" },
			attemptCount: 0,
		});

		const pending = memoryStore([
			record({ operationId: "op-in", uncertain: true, attemptCount: 1 }),
			{ ...clockOut },
		]);
		const order: string[] = [];
		const inOrder = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method !== "POST") return json(200, capabilities);
			const { operationId } = JSON.parse(String(init.body));
			order.push(operationId);
			return json(201, {
				outcome: "executed",
				operationId,
				receipt:
					operationId === "op-in"
						? startReceipt("op-in")
						: { kind: "close_active_work", result: { clockOutEntryId: "op-out" } },
			});
		});
		await dispatch.process({ store: pending, fetch: inOrder, origin: "https://z8.test" });
		expect(order).toEqual(["op-in", "op-out"]);
		expect(pending.records.map((item) => item.state)).toEqual(["committed", "committed"]);
	});

	it("lets independent work continue while another command waits for review", async () => {
		const store = memoryStore([
			record({
				operationId: "op-held",
				state: "review_required",
				lastOutcome: { kind: "rejected", code: "collision" },
			}),
			record({ operationId: "op-next", sequence: 2 }),
		]);
		const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === "POST"
				? json(201, {
						outcome: "executed",
						operationId: "op-next",
						receipt: startReceipt("op-next"),
					})
				: json(200, capabilities),
		);
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(store.records.map((item) => item.state)).toEqual(["review_required", "committed"]);
	});

	it("resolves an attended first-attempt rejection and keeps unattended or uncertain ones for review", async () => {
		const rejected = (operationId: string) =>
			json(422, {
				outcome: "rejected",
				operationId,
				code: "not_allowed_at_time",
				holidayName: "Neujahr",
			});
		const attended = memoryStore([record({ operationId: "op-in" })]);
		await dispatch.process({
			store: attended,
			fetch: async (_url: string, init?: RequestInit) =>
				init?.method === "POST" ? rejected("op-in") : json(200, capabilities),
			origin: "https://z8.test",
			attendedOperationId: "op-in",
		});
		expect(attended.records[0]).toMatchObject({
			state: "rejected",
			lastOutcome: { kind: "rejected", code: "not_allowed_at_time", holidayName: "Neujahr" },
		});

		const unattended = memoryStore([record({ operationId: "op-in" })]);
		await dispatch.process({
			store: unattended,
			fetch: async (_url: string, init?: RequestInit) =>
				init?.method === "POST" ? rejected("op-in") : json(200, capabilities),
			origin: "https://z8.test",
		});
		// Resolved only once the page confirms it showed the refusal (acknowledgment).
		expect(attended.records[0]).not.toHaveProperty("resolvedAt");
		expect(unattended.records[0]).toMatchObject({ state: "review_required" });

		const uncertain = memoryStore([
			record({ operationId: "op-in", uncertain: true, attemptCount: 1 }),
		]);
		await dispatch.process({
			store: uncertain,
			fetch: async (_url: string, init?: RequestInit) =>
				init?.method === "POST" ? rejected("op-in") : json(200, capabilities),
			origin: "https://z8.test",
			attendedOperationId: "op-in",
		});
		expect(uncertain.records[0]).toMatchObject({ state: "review_required", uncertain: true });
	});

	it("keeps looking up an archived uncertain command and records its commit", async () => {
		const store = memoryStore([
			record({ operationId: "op-in", state: "archived", uncertain: true, attemptCount: 1 }),
		]);
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "POST") throw new Error("must not submit");
			return url.endsWith("/op-in")
				? json(200, { outcome: "committed", operationId: "op-in", receipt: startReceipt("op-in") })
				: json(200, capabilities);
		});
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(store.records[0]).toMatchObject({ state: "committed", uncertain: false });
	});

	it("re-checks uncertain review records by lookup and never resubmits them", async () => {
		const store = memoryStore([
			record({
				operationId: "op-in",
				state: "review_required",
				uncertain: true,
				attemptCount: 2,
				lastOutcome: { kind: "rejected", code: "admission_window" },
			}),
		]);
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "POST") throw new Error("must not submit");
			return url.endsWith("/op-in")
				? json(200, { outcome: "not_committed", operationId: "op-in" })
				: json(200, capabilities);
		});
		await dispatch.process({ store, fetch, origin: "https://z8.test" });
		expect(store.records[0]).toMatchObject({ state: "review_required", uncertain: false });
	});

	it.each([
		[401, { outcome: "rejected", code: "unauthorized" }, "unauthorized"],
		[402, { outcome: "rejected", code: "billing_required" }, "billing_required"],
		[403, { outcome: "rejected", code: "access_denied" }, "access_denied"],
		[409, { outcome: "rejected", code: "not_adopted" }, "not_adopted"],
		[
			409,
			{ outcome: "rejected", code: "context_mismatch", fields: ["server"] },
			"context_mismatch",
		],
		[422, { outcome: "rejected", code: "unsupported_version" }, "unsupported_version"],
	])(
		"keeps a %i %j rejection pending with a hold instead of review",
		async (status, body, reason) => {
			const store = memoryStore([record({ operationId: "op-in" })]);
			await dispatch.process({
				store,
				fetch: async (_url: string, init?: RequestInit) =>
					init?.method === "POST"
						? json(status, { ...body, operationId: "op-in" })
						: json(200, capabilities),
				origin: "https://z8.test",
				attendedOperationId: "op-in",
			});
			expect(store.records[0]).toMatchObject({ state: "pending", hold: { reason } });
		},
	);

	it("reports session and network problems without touching records", async () => {
		const store = memoryStore([record({ operationId: "op-in" })]);
		expect(
			(
				await dispatch.process({
					store,
					fetch: async () => json(401, {}),
					origin: "https://z8.test",
				})
			).status,
		).toBe("unauthorized");
		expect(
			(
				await dispatch.process({
					store,
					fetch: async () => {
						throw new TypeError("Failed to fetch");
					},
					origin: "https://z8.test",
				})
			).status,
		).toBe("offline");
		expect(store.update).not.toHaveBeenCalled();
	});

	it("does not start a second run while one is in flight", async () => {
		const store = memoryStore([record({ operationId: "op-in" })]);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let posts = 0;
		const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method !== "POST") return json(200, capabilities);
			posts++;
			await gate;
			return json(201, {
				outcome: "executed",
				operationId: "op-in",
				receipt: startReceipt("op-in"),
			});
		});
		const first = dispatch.process({ store, fetch, origin: "https://z8.test" });
		const second = dispatch.process({ store, fetch, origin: "https://z8.test" });
		release();
		await Promise.all([first, second]);
		expect(posts).toBe(1);
	});
});
