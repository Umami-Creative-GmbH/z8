import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import {
	createSCIMProjectionRecoveryStore,
	retryDueSCIMProjectionRecovery,
	type SCIMProjectionRecoveryClaim,
	type SCIMProjectionRecoveryStore,
} from "./projection-recovery";

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const node = value as { name?: unknown; queryChunks?: unknown[] };
	return [
		...(typeof node.name === "string" ? [node.name] : []),
		...(node.queryChunks?.flatMap(collectColumnNames) ?? []),
	];
}

function collectValues(value: unknown): unknown[] {
	if (!value || typeof value !== "object") return [];
	const node = value as { value?: unknown; queryChunks?: unknown[] };
	return [
		...(node.value !== undefined ? [node.value] : []),
		...(node.queryChunks?.flatMap(collectValues) ?? []),
	];
}

function dueStore(): SCIMProjectionRecoveryStore & { status: string } {
	const claim: SCIMProjectionRecoveryClaim = {
		id: "recovery_opaque",
		organizationId: "org_target",
		claimToken: "claim_opaque",
		attemptCount: 2,
	};
	return {
		status: "pending",
		begin: async () => claim,
		claimDue: async function (organizationId) {
			if (organizationId !== "org_target" || this.status !== "pending")
				return null;
			this.status = "processing";
			return claim;
		},
		complete: async function () {
			this.status = "completed";
		},
		defer: async function () {
			this.status = "pending";
		},
	};
}

describe("retryDueSCIMProjectionRecovery", () => {
	it("claims and completes one organization-qualified due recovery", async () => {
		const store = dueStore();
		const replay = vi.fn().mockResolvedValue(undefined);

		await expect(
			retryDueSCIMProjectionRecovery({
				organizationId: "org_target",
				store,
				replay,
				now: Temporal.Instant.from("2026-08-25T00:00:00Z"),
			}),
		).resolves.toBe(true);
		expect(replay).toHaveBeenCalledWith("org_target");
		expect(store.status).toBe("completed");
	});

	it("is idempotent when a second retry cannot claim the same recovery", async () => {
		const store = dueStore();
		const replay = vi.fn().mockResolvedValue(undefined);

		const first = await retryDueSCIMProjectionRecovery({
			organizationId: "org_target",
			store,
			replay,
		});
		const second = await retryDueSCIMProjectionRecovery({
			organizationId: "org_target",
			store,
			replay,
		});

		expect([first, second]).toEqual([true, false]);
		expect(replay).toHaveBeenCalledTimes(1);
	});

	it("defers a failed retry without persisting the unsafe error text", async () => {
		const store = dueStore();
		store.defer = vi.fn(async () => {
			store.status = "pending";
		});

		await expect(
			retryDueSCIMProjectionRecovery({
				organizationId: "org_target",
				store,
				replay: async () => {
					throw new Error("secret provider response");
				},
			}),
		).rejects.toThrow("secret provider response");
		expect(store.defer).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org_target" }),
			expect.any(Temporal.Instant),
		);
		expect(store.status).toBe("pending");
	});
});

describe("createSCIMProjectionRecoveryStore", () => {
	it("qualifies claims and claim state transitions by organization", async () => {
		const wheres: unknown[] = [];
		const sets: Record<string, unknown>[] = [];
		let dueLimit: number | undefined;
		const row = {
			id: "recovery_opaque",
			organizationId: "org_target",
			claimToken: "00000000-0000-4000-8000-000000000001",
			attemptCount: 2,
		};
		const database = {
			select: vi.fn(() => ({
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: (limit: number) => {
								dueLimit = limit;
								return {};
							},
						}),
					}),
				}),
			})),
			update: vi.fn(() => ({
				set: (set: Record<string, unknown>) => {
					sets.push(set);
					return {
						where: (where: unknown) => {
							wheres.push(where);
							const query = Object.assign(Promise.resolve(undefined), {
								returning: async () => [row],
							});
							return query;
						},
					};
				},
			})),
		};
		const store = createSCIMProjectionRecoveryStore(database as never);
		const now = Temporal.Instant.from("2026-08-25T00:00:00Z");

		const claim = await store.claimDue("org_target", now);
		expect(claim).toEqual(row);
		expect(dueLimit).toBe(1);
		await store.complete(row, now);
		await store.defer(row, now);

		expect(wheres).toHaveLength(3);
		for (const where of wheres) {
			expect(collectColumnNames(where)).toContain("organization_id");
			expect(collectValues(where).flat()).toContain("org_target");
		}
		expect(collectColumnNames(wheres[0])).toEqual(
			expect.arrayContaining(["available_at", "status"]),
		);
		expect(collectValues(wheres[0]).flat()).toEqual(
			expect.arrayContaining(["pending", "processing"]),
		);
		expect(collectColumnNames(wheres[1])).toEqual(
			expect.arrayContaining(["id", "claim_token"]),
		);
		expect(sets[2]?.lastErrorCode).toBe("projection_replay_failed");
		expect(sets[2]).toMatchObject({
			status: "pending",
			claimToken: null,
			claimedAt: null,
		});
		expect(sets[2]?.availableAt).toEqual(new Date("2026-08-25T00:01:00Z"));
		expect(sets.flatMap(Object.values)).not.toContain(
			"secret provider response",
		);
	});

	it("persists organization-qualified recovery before returning its lease", async () => {
		let values: Record<string, unknown> | undefined;
		const row = {
			id: "recovery_opaque",
			organizationId: "org_target",
			claimToken: "00000000-0000-4000-8000-000000000001",
			attemptCount: 1,
		};
		const database = {
			insert: vi.fn(() => ({
				values: (input: Record<string, unknown>) => {
					values = input;
					return { returning: async () => [row] };
				},
			})),
		};
		const store = createSCIMProjectionRecoveryStore(database as never);

		await store.begin(
			"org_target",
			Temporal.Instant.from("2026-08-25T00:00:00Z"),
		);

		expect(values?.organizationId).toBe("org_target");
		expect(values?.status).toBe("processing");
		expect(database.insert).toHaveBeenCalledTimes(1);
	});

	it.each(["complete", "defer"] as const)(
		"rejects %s when the exact intent lease is no longer owned",
		async (transition) => {
			const database = {
				update: vi.fn(() => ({
					set: () => ({
						where: () => ({ returning: async () => [] }),
					}),
				})),
			};
			const store = createSCIMProjectionRecoveryStore(database as never);
			const claim = {
				id: "intent_a",
				organizationId: "org_target",
				claimToken: "claim_a",
				attemptCount: 1,
			};

			await expect(
				transition === "complete"
					? store.complete(claim)
					: store.defer(claim, Temporal.Instant.from("2026-08-25T00:00:00Z")),
			).rejects.toThrow("SCIM projection recovery lease is no longer owned");
		},
	);
});
