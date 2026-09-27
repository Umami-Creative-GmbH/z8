/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The existing runner owns, migrates, and removes the disposable database.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scimSeatSyncOutbox } from "@/db/schema/scim";
import { integrationAdminPool } from "@/test/integration-database";
import { createSCIMSeatSyncOutboxStore } from "./seat-sync-outbox";

const runId = randomUUID();
const organizationId = `scim-seat-sync-org-${runId}`;
const now = Temporal.Instant.from("2026-08-25T12:00:00Z");

describe("SCIM seat sync outbox PostgreSQL leases", () => {
	const pool = integrationAdminPool();
	const database = drizzle({ client: pool });
	const store = createSCIMSeatSyncOutboxStore(database);

	beforeAll(async () => {
		await pool.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'SCIM seat sync', $2, $3)`,
			[organizationId, organizationId, new Date(now.epochMilliseconds)],
		);
	});

	beforeEach(async () => {
		await database
			.delete(scimSeatSyncOutbox)
			.where(eq(scimSeatSyncOutbox.organizationId, organizationId));
	});

	afterAll(async () => {
		try {
			await pool.query("delete from organization where id = $1", [
				organizationId,
			]);
		} finally {
		}
	});

	async function seed(count: number, availableAt = now) {
		await database.insert(scimSeatSyncOutbox).values(
			Array.from({ length: count }, (_, index) => ({
				id: randomUUID(),
				organizationId,
				connectionId: `connection-${runId}`,
				membershipRevision: index + 1,
				dedupeKey: `seat-sync-${runId}-${index}`,
				status: "pending" as const,
				availableAt: new Date(availableAt.epochMilliseconds),
			})),
		);
	}

	it("gives concurrent claimers disjoint due rows with SKIP LOCKED", async () => {
		await seed(100);

		const [first, second] = await Promise.all([
			store.claimDue(now),
			store.claimDue(now),
		]);

		expect(first).toHaveLength(50);
		expect(second).toHaveLength(50);
		expect(new Set([...first, ...second].map((claim) => claim.id)).size).toBe(
			100,
		);
	}, 15_000);

	it("reclaims a processing lease only after availableAt expires", async () => {
		await seed(1);
		const [initialClaim] = await store.claimDue(now);
		expect(initialClaim).toBeDefined();

		await expect(
			store.claimDue(now.add({ minutes: 4, seconds: 59 })),
		).resolves.toEqual([]);
		const [reclaimedClaim] = await store.claimDue(now.add({ minutes: 5 }));

		expect(reclaimedClaim).toMatchObject({ id: initialClaim?.id });
		expect(reclaimedClaim?.claimToken).not.toBe(initialClaim?.claimToken);
	});

	it("rejects stale tokens after reclaim while the current token can complete", async () => {
		await seed(1);
		const [staleClaim] = await store.claimDue(now);
		const [currentClaim] = await store.claimDue(now.add({ minutes: 5 }));
		if (!staleClaim || !currentClaim)
			throw new Error("Expected both SCIM seat claims");

		await expect(
			store.complete(staleClaim, now.add({ minutes: 5 })),
		).rejects.toThrow("no longer owned");
		await expect(
			store.defer(staleClaim, now.add({ minutes: 5 }), "stale failure"),
		).rejects.toThrow("no longer owned");
		await expect(
			store.complete(currentClaim, now.add({ minutes: 5 })),
		).resolves.toBeUndefined();
	});

	it("excludes completed rows from later claims", async () => {
		await seed(1);
		const [claim] = await store.claimDue(now);
		if (!claim) throw new Error("Expected a SCIM seat claim");
		await store.complete(claim, now);

		await expect(store.claimDue(now.add({ hours: 1 }))).resolves.toEqual([]);
	});
});
