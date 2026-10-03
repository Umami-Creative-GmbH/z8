import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { AutoClockOutTaskLeaseNotOwnedError, createAutoClockOutTaskOutbox } from "./outbox";
import { NOW, seedExecution } from "./testing.test.fixture";

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => logger }));

describe("automatic clock-out task leases", () => {
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});
	it("has one claim owner, reclaims after five minutes, and rejects stale and foreign progress/completion", async () => {
		const { facts } = await seedExecution(fixture);
		const box = createAutoClockOutTaskOutbox(fixture.db);
		const batches = await Promise.all([box.claimDue(NOW, 100), box.claimDue(NOW, 100)]);
		const original = batches.flat().filter((c) => c.operationId === facts.operationId);
		expect(original).toHaveLength(1);
		expect(await box.claimDue(NOW.add({ minutes: 4 }), 100)).toEqual([]);
		const [renewed] = await box.claimDue(NOW.add({ minutes: 5 }), 100);
		expect(renewed.claimToken).not.toBe(original[0].claimToken);
		await expect(box.complete(original[0], NOW)).rejects.toBeInstanceOf(
			AutoClockOutTaskLeaseNotOwnedError,
		);
		await expect(box.recordProgress(original[0], NOW, { done: true })).rejects.toBeInstanceOf(
			AutoClockOutTaskLeaseNotOwnedError,
		);
		await expect(
			box.complete({ ...renewed, organizationId: "foreign" }, NOW),
		).rejects.toBeInstanceOf(AutoClockOutTaskLeaseNotOwnedError);
		await box.recordProgress(renewed, NOW, { done: true });
		await box.complete(renewed, NOW);
		const row = (
			await fixture.pool.query("select * from automatic_clock_out_task where organization_id=$1", [
				facts.organizationId,
			])
		).rows[0];
		expect(row).toMatchObject({
			status: "completed",
			claim_token: null,
			lease_expires_at: null,
			payload: { done: true },
		});
	});
	it("backs off and retains the eighth failure with safe text and both lease fields cleared", async () => {
		const { facts } = await seedExecution(fixture);
		const box = createAutoClockOutTaskOutbox(fixture.db);
		let at = NOW;
		for (let attempt = 1; attempt <= 8; attempt++) {
			const [claim] = await box.claimDue(at, 100);
			expect(claim.attemptCount).toBe(attempt);
			expect(
				await box.defer(claim, at, new Error("secret https://user:pass@host/?token=xyz\n")),
			).toBe(attempt === 8 ? "failed" : "deferred");
			const row = (
				await fixture.pool.query(
					"select * from automatic_clock_out_task where organization_id=$1",
					[facts.organizationId],
				)
			).rows[0];
			expect(row.claim_token).toBeNull();
			expect(row.lease_expires_at).toBeNull();
			expect(row.last_error).not.toContain("xyz");
			expect(row.last_error).not.toContain("pass");
			expect(await box.claimDue(at, 100)).toEqual([]);
			at = at.add({ seconds: Math.min(30 * 2 ** (attempt - 1), 3600) });
		}
		expect(await box.claimDue(at.add({ hours: 2 }), 100)).toEqual([]);
		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: facts.organizationId,
				reason: "attempts_exhausted",
			}),
			"Automatic clock-out task exhausted its attempts",
		);
	});
	it("reports an expired eighth crash exactly when it becomes failed, without payloads", async () => {
		const { facts } = await seedExecution(fixture);
		const box = createAutoClockOutTaskOutbox(fixture.db);
		const [claim] = await box.claimDue(NOW, 100);
		await fixture.pool.query(
			"update automatic_clock_out_task set attempt_count=8 where organization_id=$1 and id=$2",
			[facts.organizationId, claim.id],
		);
		logger.error.mockClear();
		expect(await box.claimDue(NOW.add({ minutes: 5 }), 100)).toEqual([]);
		expect(logger.error).toHaveBeenCalledExactlyOnceWith(
			{
				organizationId: facts.organizationId,
				taskId: claim.id,
				operationId: facts.operationId,
				reason: "attempts_exhausted",
			},
			"Automatic clock-out task exhausted its attempts",
		);
		expect(await box.claimDue(NOW.add({ minutes: 6 }), 100)).toEqual([]);
		expect(logger.error).toHaveBeenCalledOnce();
		expect(
			(
				await fixture.pool.query(
					"select status, claim_token, lease_expires_at from automatic_clock_out_task where organization_id=$1 and id=$2",
					[facts.organizationId, claim.id],
				)
			).rows[0],
		).toEqual({ status: "failed", claim_token: null, lease_expires_at: null });
	});
});
