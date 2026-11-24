/**
 * #2010 (spec #1935): the Minijob monitor reads employee time only. An External Contractor on
 * Minijob terms earns nothing towards the cap; a converted person earns only from the conversion
 * instant on, so the contractor morning of the conversion day is no Minijob pay.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { type FixtureOrganization, statutoryFixture } from "@/test/statutory-fixtures";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import { minijobFixture } from "./__tests__/minijob-database-fixture";

describe("Minijob earnings of External Contractors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2010-mj");
	const mj = minijobFixture(admin, fx);

	beforeEach(async () => {
		mj.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	const MARCH = { from: "2026-03", until: "2026-04" };
	/** Monday 16 March 2026, 12:00 in Berlin. */
	const CONVERSION = "2026-03-16T11:00:00Z";

	async function setup() {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		return { org, owner };
	}

	function evaluate(org: FixtureOrganization, employeeIds: string[]) {
		return evaluateMinijobEarnings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds,
			months: MARCH,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: Temporal.Instant.from("2026-11-23T12:00:00Z"),
		});
	}

	it("judges no month of a contractor on Minijob terms; the same employee exceeds the cap", async () => {
		const { org, owner } = await setup();
		const contractor = await fx.employee(org, "contractor", { contractType: "hourly" });
		const employee = await fx.employee(org, "employee", { contractType: "hourly" });
		await fx.stint(contractor, "contractor", "2025-12-31T23:00:00Z");
		for (const worker of [contractor, employee]) {
			await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 15 });
			// 50 h at 15 €: 750 € in March.
			await mj.monthWork(org, worker, "2026-03", 3000);
		}

		const { findings, employees } = await evaluate(org, [
			contractor.employeeId,
			employee.employeeId,
		]);

		expect(employees.has(contractor.employeeId)).toBe(false);
		expect(findings.map((finding) => [finding.employeeId, finding.kind])).toEqual([
			[employee.employeeId, "minijob_monthly_cap"],
		]);
		expect(findings[0]?.adminDetail?.amountsCents?.total).toBe(75_000);
	});

	it("counts a converted person's pay from the conversion instant on", async () => {
		const { org, owner } = await setup();
		const converted = await fx.employee(org, "converted", { contractType: "hourly" });
		const contractorStint = await fx.stint(converted, "contractor", "2025-12-31T23:00:00Z");
		// As a contractor: 40 h in early March and 08:00–11:00 on the conversion day.
		await mj.monthWork(org, converted, "2026-03", 2400);
		await mj.work(org, converted, "2026-03-16", 180, "08:00");
		await fx.endStint(contractorStint, CONVERSION);
		await fx.stint(converted, "employee", CONVERSION);
		await mj.terms(converted, owner, { from: "2026-03-16", hourlyRate: 15 });
		// As an employee: 13:00–15:00 on the conversion day and 10 h on the next.
		await mj.work(org, converted, "2026-03-16", 120, "13:00");
		await mj.work(org, converted, "2026-03-17", 600, "08:00");

		const { findings, employees } = await evaluate(org, [converted.employeeId]);

		// 12 h at 15 €: 180 €, within the cap.
		const march = employees.get(converted.employeeId)?.find((month) => month.month === "2026-03");
		expect(march).toMatchObject({ isMinijob: true, earnedCents: 18_000, totalCents: 18_000 });
		expect(findings).toEqual([]);
	});
});
