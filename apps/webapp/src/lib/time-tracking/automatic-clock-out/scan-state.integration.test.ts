import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { AutoClockOutScanLeaseNotOwnedError, createAutoClockOutScanState } from "./scan-state";

const now = parseInstant("2026-10-25T06:00:00Z");
const after = {
	organizationId: "org",
	employeeId: "employee",
	workPeriodId: "period",
};
describe("automatic clock-out durable scan lease", () => {
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	beforeEach(async () => {
		await fixture.pool.query("delete from automatic_clock_out_scan_state");
	});
	afterAll(async () => {
		await fixture.pool.query("delete from automatic_clock_out_scan_state");
		await fixture.pool.query(
			"insert into automatic_clock_out_scan_state (id) values ('maintenance')",
		);
		await fixture.close();
	});
	it("allows one concurrent claimant, persists progress, renews five minutes, and rejects stale owners", async () => {
		const state = createAutoClockOutScanState(fixture.db);
		const claims = (await Promise.all([state.claim(now), state.claim(now)])).filter(
			(c) => c !== null,
		);
		expect(claims).toHaveLength(1);
		const original = claims[0];
		expect(original.after).toBeNull();
		await state.advance({
			token: original.token,
			after,
			now: now.add({ minutes: 4 }),
		});
		expect(await state.claim(now.add({ minutes: 5 }))).toBeNull();
		const replacement = await state.claim(now.add({ minutes: 9 }));
		expect(replacement?.token).not.toBe(original.token);
		expect(replacement?.after).toEqual(after);
		await expect(
			state.advance({
				token: original.token,
				after,
				now: now.add({ minutes: 9 }),
			}),
		).rejects.toBeInstanceOf(AutoClockOutScanLeaseNotOwnedError);
		await expect(
			state.release({
				token: original.token,
				after: null,
				now: now.add({ minutes: 9 }),
			}),
		).rejects.toBeInstanceOf(AutoClockOutScanLeaseNotOwnedError);
		if (!replacement) throw new Error("Missing replacement");
		await state.release({
			token: replacement.token,
			after: null,
			now: now.add({ minutes: 9 }),
		});
		expect((await state.claim(now.add({ minutes: 9 })))?.after).toBeNull();
	});
	it("does not let an expired owner renew or release even before replacement", async () => {
		const state = createAutoClockOutScanState(fixture.db);
		const claim = await state.claim(now);
		if (!claim) throw new Error("Missing claim");
		await expect(
			state.advance({
				token: claim.token,
				after,
				now: now.add({ minutes: 5 }),
			}),
		).rejects.toBeInstanceOf(AutoClockOutScanLeaseNotOwnedError);
		await expect(
			state.release({
				token: claim.token,
				after,
				now: now.add({ minutes: 5 }),
			}),
		).rejects.toBeInstanceOf(AutoClockOutScanLeaseNotOwnedError);
	});
});
