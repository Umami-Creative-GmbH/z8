/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The existing runner owns, migrates, and removes the disposable database.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scimSeatSyncOutbox } from "@/db/schema/scim";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { createSCIMSeatSyncOutboxStore } from "./seat-sync-outbox";

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired =
	process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration =
	resolveApprovalWorkflowRepositoryTestConfiguration({
		databaseUrl,
		required: integrationRequired,
		sentinel: testSentinel,
	});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid SCIM seat sync integration test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`SCIM seat sync PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const runId = randomUUID();
const organizationId = `scim-seat-sync-org-${runId}`;
const now = Temporal.Instant.from("2026-08-25T12:00:00Z");

describeIntegration("SCIM seat sync outbox PostgreSQL leases", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 8 });
	const database = drizzle({ client: pool });
	const store = createSCIMSeatSyncOutboxStore(database);

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await pool.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("SCIM seat sync integration test is not enabled");
		}
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
			await pool.end();
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
		expect(new Set([...first, ...second].map((claim) => claim.id))).toHaveSize(
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
