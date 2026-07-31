import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalDbService,
	ApprovalOutboxWriteInput,
} from "../workflow/ports";
import { createApprovalOutboxWriter } from "./writer";

const createdAt = parseInstant("2026-07-16T12:30:00Z");

function input(
	overrides: Partial<ApprovalOutboxWriteInput> = {},
): ApprovalOutboxWriteInput {
	return {
		organizationId: "org-1",
		workflowId: "10000000-0000-4000-8000-000000000001",
		eventId: "20000000-0000-4000-8000-000000000001",
		eventType: "workflow.approved",
		dedupeKey: "workflow:1:event:2",
		payload: { workflowStatus: "approved", sourceType: "absence_entry" },
		disposition: "deliver",
		createdAt,
		...overrides,
	};
}

function fakeService(rows: unknown[] = [{ id: "outbox-1" }]) {
	const calls: SQL[] = [];
	let transactionCalls = 0;
	const service = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				return { rows };
			},
			transaction: () => {
				transactionCalls += 1;
			},
		},
	} as unknown as ApprovalDbService;
	return { service, calls, transactionCalls: () => transactionCalls };
}

function sequenceService(responses: Array<unknown[] | Error>) {
	const calls: SQL[] = [];
	let index = 0;
	const service = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				const response = responses[index++];
				if (response instanceof Error) throw response;
				return { rows: response ?? [] };
			},
		},
	} as ApprovalDbService;
	return { service, calls };
}

function existingRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "outbox-existing",
		workflow_id: "10000000-0000-4000-8000-000000000001",
		event_id: "20000000-0000-4000-8000-000000000001",
		event_type: "workflow.approved",
		disposition: "deliver",
		payload: { sourceType: "absence_entry", workflowStatus: "approved" },
		...overrides,
	};
}

describe("approval outbox writer", () => {
	it.each([
		"observe",
		"deliver",
	] as const)("captures %s disposition with pending expansion and coherent event identity", async (disposition) => {
		const fake = fakeService();
		const result = await createApprovalOutboxWriter(fake.service).write(
			input({ disposition }),
		);
		const query = new PgDialect().sqlToQuery(fake.calls[0] as SQL);

		expect(result).toEqual({ kind: "inserted", id: "outbox-1" });
		expect(query.sql).toContain("insert into approval_outbox");
		expect(query.sql).toContain("expansion_status");
		expect(query.sql).toContain(
			"on conflict (organization_id, dedupe_key) do nothing",
		);
		expect(query.params).toEqual(
			expect.arrayContaining([
				"org-1",
				"10000000-0000-4000-8000-000000000001",
				"20000000-0000-4000-8000-000000000001",
				"workflow.approved",
				"workflow:1:event:2",
				disposition,
				"pending",
			]),
		);
		expect(query.params).toContainEqual(new Date("2026-07-16T12:30:00Z"));
		expect(fake.transactionCalls()).toBe(0);
	});

	it("returns an explicit duplicate result for the same organization-scoped dedupe key", async () => {
		const fake = sequenceService([[], [existingRow()]]);
		await expect(
			createApprovalOutboxWriter(fake.service).write(input()),
		).resolves.toEqual({ kind: "duplicate", id: "outbox-existing" });
		const select = new PgDialect().sqlToQuery(fake.calls[1] as SQL);
		expect(select.sql).toContain("from approval_outbox");
		expect(select.params).toEqual(["org-1", "workflow:1:event:2"]);
	});

	it("accepts semantically equal JSON payloads regardless of object key order", async () => {
		const fake = sequenceService([
			[],
			[
				existingRow({
					payload: {
						workflowStatus: "approved",
						sourceType: "absence_entry",
					},
				}),
			],
		]);
		await expect(
			createApprovalOutboxWriter(fake.service).write(
				input({
					payload: {
						sourceType: "absence_entry",
						workflowStatus: "approved",
					},
				}),
			),
		).resolves.toEqual({ kind: "duplicate", id: "outbox-existing" });
	});

	it("persists and compares one recursively canonical JSON representation", async () => {
		const payload = {
			zebra: [{ beta: true, alpha: null }, [3, "two", false]],
			alpha: { delta: 4, charlie: "value" },
		};
		const fake = sequenceService([
			[],
			[
				existingRow({
					payload: {
						alpha: { charlie: "value", delta: 4 },
						zebra: [{ alpha: null, beta: true }, [3, "two", false]],
					},
				}),
			],
		]);

		await expect(
			createApprovalOutboxWriter(fake.service).write(input({ payload })),
		).resolves.toEqual({ kind: "duplicate", id: "outbox-existing" });
		const insert = new PgDialect().sqlToQuery(fake.calls[0] as SQL);
		expect(insert.params).toContain(
			'{"alpha":{"charlie":"value","delta":4},"zebra":[{"alpha":null,"beta":true},[3,"two",false]]}',
		);
	});

	it("normalizes negative zero to zero for persistence and retries", async () => {
		const fake = sequenceService([
			[],
			[existingRow({ payload: { value: 0 } })],
		]);

		await expect(
			createApprovalOutboxWriter(fake.service).write(
				input({ payload: { value: -0 } }),
			),
		).resolves.toEqual({ kind: "duplicate", id: "outbox-existing" });
		const insert = new PgDialect().sqlToQuery(fake.calls[0] as SQL);
		expect(insert.params).toContain('{"value":0}');
		expect(insert.params).not.toContain('{"value":-0}');
	});

	it.each([
		["NaN", () => ({ invalid: Number.NaN })],
		["positive infinity", () => ({ invalid: Number.POSITIVE_INFINITY })],
		["negative infinity", () => ({ invalid: Number.NEGATIVE_INFINITY })],
		["undefined object value", () => ({ invalid: undefined })],
		["undefined array value", () => ({ invalid: [undefined] })],
		[
			"sparse array hole",
			() => {
				const sparse: unknown[] = [];
				sparse[1] = "present";
				return { invalid: sparse };
			},
		],
		["function", () => ({ invalid: () => "value" })],
		["bigint", () => ({ invalid: 1n })],
		["symbol", () => ({ invalid: Symbol("value") })],
		[
			"cycle",
			() => {
				const cyclic: Record<string, unknown> = {};
				cyclic.self = cyclic;
				return cyclic;
			},
		],
		["non-plain object", () => ({ invalid: new Date(0) })],
		[
			"symbol-keyed object property",
			() => ({ valid: true, [Symbol("hidden")]: "invalid" }),
		],
		[
			"non-enumerable object property",
			() => {
				const payload = { valid: true };
				Object.defineProperty(payload, "hidden", { value: "invalid" });
				return payload;
			},
		],
		[
			"accessor object property",
			() => {
				const payload = { valid: true };
				Object.defineProperty(payload, "computed", {
					enumerable: true,
					get: () => "invalid",
				});
				return payload;
			},
		],
	] as const)("rejects runtime-invalid JSON payloads before INSERT: %s", async (_name, payload) => {
		const fake = fakeService();

		await expect(
			createApprovalOutboxWriter(fake.service).write(
				input({
					payload: payload() as unknown as ApprovalOutboxWriteInput["payload"],
				}),
			),
		).rejects.toThrow(/valid JSON/i);
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		["workflow", { workflow_id: "10000000-0000-4000-8000-999999999999" }],
		["event", { event_id: "20000000-0000-4000-8000-999999999999" }],
		["event type", { event_type: "workflow.rejected" }],
		["disposition", { disposition: "observe" }],
		["payload", { payload: { workflowStatus: "rejected" } }],
	] as const)("rejects a duplicate dedupe key with mismatched %s identity", async (_name, mismatch) => {
		const fake = sequenceService([[], [existingRow(mismatch)]]);
		await expect(
			createApprovalOutboxWriter(fake.service).write(input()),
		).rejects.toThrow(/idempotency conflict/i);
	});

	it("rejects a zero-row conflict when the scoped existing row is missing", async () => {
		const fake = sequenceService([[], []]);
		await expect(
			createApprovalOutboxWriter(fake.service).write(input()),
		).rejects.toThrow(/idempotency conflict.*missing/i);
	});

	it("propagates failure while loading the existing conflict row", async () => {
		const fake = sequenceService([[], new Error("conflict select failed")]);
		await expect(
			createApprovalOutboxWriter(fake.service).write(input()),
		).rejects.toThrow("conflict select failed");
	});

	it("allows the same dedupe key in another organization by including organizationId", async () => {
		const first = fakeService([{ id: "one" }]);
		const second = fakeService([{ id: "two" }]);
		await createApprovalOutboxWriter(first.service).write(input());
		await createApprovalOutboxWriter(second.service).write(
			input({ organizationId: "org-2" }),
		);
		const firstQuery = new PgDialect().sqlToQuery(first.calls[0] as SQL);
		const secondQuery = new PgDialect().sqlToQuery(second.calls[0] as SQL);
		expect(firstQuery.params).toContain("org-1");
		expect(secondQuery.params).toContain("org-2");
	});

	it("propagates database failures", async () => {
		const service = {
			db: { execute: async () => Promise.reject(new Error("insert failed")) },
		} as unknown as ApprovalDbService;
		await expect(
			createApprovalOutboxWriter(service).write(input()),
		).rejects.toThrow("insert failed");
	});
});
