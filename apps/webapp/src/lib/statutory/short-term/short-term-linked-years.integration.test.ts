/**
 * #1990: a fixed-term employment across the year end loads its other year, and only for the
 * employee it belongs to: everyone else evaluated with them is loaded once, on the requested years.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { evaluateShortTermEmployment } from "./evaluate";
import { loadShortTermInputs } from "./load-inputs";
import { shortTermFixture } from "./__tests__/short-term-fixture";

vi.mock("./load-inputs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./load-inputs")>();
	return { ...actual, loadShortTermInputs: vi.fn(actual.loadShortTermInputs) };
});

describe("short-term evaluation across the year end (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1990-linked");
	const st = shortTermFixture(admin, () => fx.user("creator"));

	beforeEach(async () => {
		st.reset();
		await fx.cleanup();
		vi.mocked(loadShortTermInputs).mockClear();
	});
	afterAll(fx.cleanup);

	const NOW = Temporal.Instant.from("2026-12-31T12:00:00Z");

	it("loads the other year only for the employee whose fixed term reaches into it", async () => {
		const org = await fx.organization("a");
		const seasonal = await fx.employee(org, "seasonal", { contractType: "hourly" });
		const helper = await fx.employee(org, "helper", { contractType: "hourly" });
		const policy = await st.weekdayPolicy(org);
		await st.terms(seasonal, { from: "2026-11-01", workPolicyId: policy });
		await st.fixedTermAgreement(seasonal, "2026-11-01", "2027-01-15");
		await st.work(org, seasonal, "2026-11-02");
		await st.terms(helper, { from: "2026-03-01", weeklyMinutes: 480 });
		for (const date of ["2026-03-02", "2026-03-03", "2026-12-29"]) await st.work(org, helper, date);
		const evaluate = (employeeIds: string[]) =>
			evaluateShortTermEmployment(db, {
				organizationId: org.id,
				timezone: org.timezone,
				employeeIds,
				years: [2026],
				now: NOW,
			});

		const together = await evaluate([seasonal.employeeId, helper.employeeId]);
		const loads = vi
			.mocked(loadShortTermInputs)
			.mock.calls.map(([, input]) => [[...input.employeeIds].sort(), [...input.years]]);
		const alone = [
			...(await evaluate([seasonal.employeeId])),
			...(await evaluate([helper.employeeId])),
		];

		// The helper once on 2026; the seasonal worker again with 2027 for its fixed term.
		expect(
			loads.filter(([employeeIds]) => (employeeIds as string[]).includes(helper.employeeId)),
		).toEqual([[expect.arrayContaining([helper.employeeId]), [2026]]]);
		expect(loads.at(-1)).toEqual([[seasonal.employeeId], [2026, 2027]]);
		// 1 November – 15 January: 76 of the 92 days from 1 November; the helper's 3 days.
		const byEmployee = new Map(together.map((e) => [e.employeeId, e.allowance]));
		expect(byEmployee.get(seasonal.employeeId)).toMatchObject({ limitKind: "months", used: 76 });
		expect(byEmployee.get(helper.employeeId)).toMatchObject({ used: 3 });
		expect(new Map(alone.map((e) => [e.employeeId, e]))).toEqual(
			new Map(together.map((e) => [e.employeeId, e])),
		);
	});
});
