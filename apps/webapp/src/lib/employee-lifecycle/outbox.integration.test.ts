/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Durable departure follow-up tasks: leases, ownership, retry and exhaustion.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureTaskOutbox } from "./outbox";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
} from "./testing/database.test.fixture";

const NOW = parseInstant("2026-09-15T00:00:00Z");

describeLifecycleDatabase("departure task outbox", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	beforeEach(async () => {
		// Claims are global infrastructure discovery; keep this suite's tasks isolated.
		await fixture.pool.query(`delete from employee_departure_task`);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seed(count: number, payload: Record<string, unknown> = {}) {
		for (let index = 0; index < count; index += 1) {
			await fixture.pool.query(
				`insert into employee_departure_task
				 (organization_id, employee_id, employment_period_id, kind, dedupe_key, payload, available_at)
				 values ($1, $2, $3, 'session_revocation', $4, $5, $6)`,
				[
					fixture.organizationId,
					fixture.employeeId,
					fixture.employmentPeriodId,
					`task-${randomUUID()}`,
					JSON.stringify(payload),
					new Date(NOW.epochMilliseconds),
				],
			);
		}
	}

	const outbox = () => createDepartureTaskOutbox(fixture.db);

	it("gives concurrent workers disjoint claims", async () => {
		await seed(100);

		const [first, second] = await Promise.all([outbox().claimDue(NOW), outbox().claimDue(NOW)]);

		expect(first).toHaveLength(50);
		expect(second).toHaveLength(50);
		expect(new Set([...first, ...second].map((claim) => claim.id)).size).toBe(100);
	});

	it("reclaims only after the lease expires and rejects the stale claim afterwards", async () => {
		await seed(1);
		const [stale] = await outbox().claimDue(NOW);
		if (!stale) throw new Error("expected a claim");

		expect(await outbox().claimDue(NOW.add({ minutes: 4, seconds: 59 }))).toEqual([]);
		const [current] = await outbox().claimDue(NOW.add({ minutes: 5 }));

		expect(current?.id).toBe(stale.id);
		await expect(outbox().complete(stale, NOW.add({ minutes: 5 }))).rejects.toThrow(
			"no longer owned",
		);
		await expect(outbox().complete(current!, NOW.add({ minutes: 6 }))).resolves.toBeUndefined();
	});

	it("keeps exhausted work visible as failed instead of completed", async () => {
		await seed(1);
		let outcome = "";
		let at = NOW;
		for (let attempt = 1; attempt <= 8; attempt += 1) {
			const [claim] = await outbox().claimDue(at.add({ hours: 2 }));
			if (!claim) throw new Error(`expected claim for attempt ${attempt}`);
			outcome = await outbox().defer(claim, at, new Error("redis unavailable"));
			at = at.add({ hours: 2 });
		}

		expect(outcome).toBe("failed");
		const stored = await fixture.pool.query(
			`select status, attempt_count, last_error from employee_departure_task`,
		);
		expect(stored.rows[0]).toMatchObject({ status: "failed", attempt_count: 8 });
		expect(await outbox().claimDue(at.add({ hours: 24 }))).toEqual([]);
	});

	it("clears private payload on completion when asked", async () => {
		await seed(1, { tokens: ["secret-token"] });
		const [claim] = await outbox().claimDue(NOW);

		await outbox().complete(claim!, NOW, { clearPayload: true });

		const stored = await fixture.pool.query(
			`select status, payload, completed_at from employee_departure_task`,
		);
		expect(stored.rows[0]).toEqual({
			status: "completed",
			payload: {},
			completed_at: new Date(NOW.epochMilliseconds),
		});
	});
});
