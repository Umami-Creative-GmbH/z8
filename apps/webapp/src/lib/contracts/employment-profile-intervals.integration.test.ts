/**
 * The employment-profile intervals agree, day by day, with the canonical batch contract resolver
 * across supersession, same-day ties, a departure mid-day and a rehire with its own terms (#1991).
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { workingStudentFixture } from "@/lib/statutory/working-student/working-student.test.fixture";
import { integrationAdminPool } from "@/test/integration-database";
import { loadEmploymentProfileIntervals } from "./employment-profile-intervals";
import { loadEffectiveContractsBatch } from "./resolve-contract";

const TZ = "Europe/Berlin";
const FROM = "2024-12-02";
const UNTIL = "2026-03-02";

describe("employment-profile intervals (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const fx = workingStudentFixture(integrationAdminPool(), "t1991-profiles");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	it("matches the per-day contract resolver on every day of the window", async () => {
		const org = await fx.organization("a", TZ);
		const changing = await fx.employee(org, "changing", { contractType: "hourly" });
		// Departure at 11:30 Berlin time on 2025-10-10, rehire on 2025-11-03.
		const first = await fx.employmentPeriod(
			org,
			changing,
			"2025-01-01T07:00:00Z",
			"2025-10-10T09:30:00Z",
		);
		const second = await fx.employmentPeriod(org, changing, "2025-11-03T08:00:00Z", null);
		const terms = (
			from: string,
			profile: "regular" | "working_student" | "short_term" | "minijob",
			employmentPeriodId: string,
			createdAt: string,
			until?: string,
		) => fx.terms(org, changing, { from, until, profile, employmentPeriodId, createdAt });
		// Confirmed terms of one stint never overlap; the last ends before the departure.
		await terms("2025-01-01", "regular", first, "2025-01-01T00:00:00Z", "2025-04-01");
		await terms("2025-04-01", "working_student", first, "2025-03-01T00:00:00Z", "2025-06-15");
		await terms("2025-06-15", "short_term", first, "2025-06-01T00:00:00Z", "2025-08-01");
		await terms("2025-08-01", "working_student", first, "2025-07-01T00:00:00Z", "2025-09-01");
		await terms("2025-11-03", "working_student", second, "2025-11-01T00:00:00Z", "2026-01-12");
		await terms("2026-01-12", "minijob", second, "2026-01-01T00:00:00Z", "2026-02-02");
		await terms("2026-02-02", "working_student", second, "2026-01-20T00:00:00Z");

		// Terms without a stint: a later row supersedes an open-ended earlier one from its start.
		const superseded = await fx.employee(org, "superseded", { contractType: "hourly" });
		for (const [from, profile, createdAt] of [
			["2025-01-01", "regular", "2025-01-01T00:00:00Z"],
			["2025-05-05", "working_student", "2025-05-01T00:00:00Z"],
			["2025-12-01", "short_term", "2025-11-01T00:00:00Z"],
			["2025-12-01", "working_student", "2025-11-02T00:00:00Z"],
		] as const) {
			await fx.terms(org, superseded, { from, profile, createdAt });
		}

		const steady = await fx.workingStudent(org, "steady");
		const employeeIds = [changing.employeeId, superseded.employeeId, steady.employeeId];

		const dates: string[] = [];
		for (
			let day = Temporal.PlainDate.from(FROM);
			Temporal.PlainDate.compare(day, Temporal.PlainDate.from(UNTIL)) < 0;
			day = day.add({ days: 1 })
		) {
			dates.push(day.toString());
		}
		const perDay = await loadEffectiveContractsBatch(db, {
			organizationId: org.id,
			employeeIds,
			dates,
			timezoneOverride: TZ,
			organizationTimezone: TZ,
		});
		const intervals = await loadEmploymentProfileIntervals(db, {
			organizationId: org.id,
			employeeIds,
			from: FROM,
			untilExclusive: UNTIL,
			timezone: TZ,
		});

		for (const employeeId of employeeIds) {
			const expected = dates.map((date) => {
				const contract = perDay.get(employeeId)?.get(date);
				return [date, contract?.isEmployedOnDay ? contract.employmentProfile : null];
			});
			const spans = intervals.get(employeeId) ?? [];
			const actual = dates.map((date) => {
				const span = spans.find(
					(candidate) => candidate.from <= date && date < candidate.untilExclusive,
				);
				return [date, span ? span.employmentProfile : "missing"];
			});
			expect(actual).toEqual(expected);
		}
		// Resolved once per distinct span, not once per day.
		expect(intervals.get(changing.employeeId)?.length).toBeGreaterThanOrEqual(7);
		expect(intervals.get(changing.employeeId)?.length).toBeLessThan(20);
		expect(intervals.get(steady.employeeId)).toEqual([
			{ from: FROM, untilExclusive: UNTIL, employmentProfile: "working_student" },
		]);
	});
});
