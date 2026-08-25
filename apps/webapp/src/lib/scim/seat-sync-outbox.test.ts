import { Temporal } from "temporal-polyfill";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
	createSCIMSeatSyncOutboxStore,
	runSCIMSeatSyncOutbox,
	type SCIMSeatSyncClaim,
	type SCIMSeatSyncOutboxStore,
} from "./seat-sync-outbox";

function compile(query: unknown) {
	return new PgDialect().sqlToQuery(query as SQL);
}

function claim(
	id: string,
	organizationId: string,
	attemptCount = 1,
): SCIMSeatSyncClaim {
	return { id, organizationId, claimToken: `token-${id}`, attemptCount };
}

describe("runSCIMSeatSyncOutbox", () => {
	it("processes independently claimed rows when one reconciliation fails", async () => {
		const claims = [claim("one", "org-one"), claim("two", "org-two")];
		const complete = vi.fn();
		const defer = vi.fn();
		const reconcile = vi
			.fn()
			.mockRejectedValueOnce(new Error("provider secret: abc"))
			.mockResolvedValueOnce(undefined);
		const store: SCIMSeatSyncOutboxStore = {
			claimDue: vi.fn().mockResolvedValue(claims),
			complete,
			defer,
		};

		await expect(runSCIMSeatSyncOutbox({ store, reconcile })).resolves.toEqual({
			claimed: 2,
			completed: 1,
			deferred: 1,
		});
		expect(reconcile).toHaveBeenNthCalledWith(1, "org-one", { strict: true });
		expect(reconcile).toHaveBeenNthCalledWith(2, "org-two", { strict: true });
		expect(complete).toHaveBeenCalledWith(
			claims[1],
			expect.any(Temporal.Instant),
		);
		expect(defer).toHaveBeenCalledWith(
			claims[0],
			expect.any(Temporal.Instant),
			"Seat reconciliation failed",
		);
	});

	it("does not process rows when claiming returns none", async () => {
		const reconcile = vi.fn();
		const store: SCIMSeatSyncOutboxStore = {
			claimDue: vi.fn().mockResolvedValue([]),
			complete: vi.fn(),
			defer: vi.fn(),
		};

		await expect(runSCIMSeatSyncOutbox({ store, reconcile })).resolves.toEqual({
			claimed: 0,
			completed: 0,
			deferred: 0,
		});
		expect(reconcile).not.toHaveBeenCalled();
	});
});

describe("createSCIMSeatSyncOutboxStore", () => {
	it("uses a skip-locked bounded claim query that can reclaim expired processing leases", async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [] });
		const store = createSCIMSeatSyncOutboxStore({ execute });

		await store.claimDue(Temporal.Instant.from("2026-08-25T00:00:00Z"));

		const query = compile(execute.mock.calls[0]?.[0]);
		expect(query.sql).toContain("FOR UPDATE SKIP LOCKED");
		expect(query.sql).toContain("LIMIT $2");
		expect(query.params).toContain(50);
		expect(query.sql).toContain("status = 'pending'");
		expect(query.sql).toContain("status = 'processing'");
		expect(query.sql).toContain("status <> 'completed'");
	});

	it("fences completion and deferral with row, organization, processing status, and claim token", async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [] });
		const store = createSCIMSeatSyncOutboxStore({ execute });
		const staleClaim = claim("row-one", "org-one", 2);

		await expect(store.complete(staleClaim)).rejects.toThrow("no longer owned");
		await expect(
			store.defer(
				staleClaim,
				Temporal.Now.instant(),
				"unsafe\nprovider response",
			),
		).rejects.toThrow("no longer owned");

		const queries = execute.mock.calls
			.map(([query]) => compile(query).sql)
			.join("\n");
		for (const column of [
			"id",
			"organization_id",
			"status = 'processing'",
			"claim_token",
		]) {
			expect(queries).toContain(column);
		}
	});

	it("bounds retry delay and sanitizes truncates persisted errors", async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [{ id: "row-one" }] });
		const store = createSCIMSeatSyncOutboxStore({ execute });
		const now = Temporal.Instant.from("2026-08-25T00:00:00Z");

		await store.defer(
			claim("row-one", "org-one", 99),
			now,
			`secret\n${"x".repeat(1_000)}`,
		);

		const query = compile(execute.mock.calls[0]?.[0]);
		expect(query.params).toContainEqual(new Date("2026-08-25T01:00:00.000Z"));
		expect(query.params).not.toContain("secret");
		expect(query.params).not.toContain(expect.stringContaining("\n"));
	});

	it("marks exhausted retries completed so they cannot be claimed again", async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [{ id: "row-one" }] });
		const store = createSCIMSeatSyncOutboxStore({ execute });

		await store.defer(
			claim("row-one", "org-one", 8),
			Temporal.Now.instant(),
			"failed",
		);

		const query = compile(execute.mock.calls[0]?.[0]);
		expect(query.params).toContain("completed");
		expect(query.sql).toContain("processed_at");
	});
});
