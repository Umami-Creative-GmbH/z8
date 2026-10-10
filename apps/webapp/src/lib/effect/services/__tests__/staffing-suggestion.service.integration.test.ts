/**
 * PostgreSQL contract (#796): staffing suggestions for an open shift leave out blocked employees
 * and anyone outside the organization, warn about skills, compliance and pending absences judged
 * per candidate, and rank by the fixed keys.
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import type { SeededEmployee } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import type { StaffingShiftInput } from "@/lib/scheduling/staffing/types";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "../database.service";
import {
	type StaffingCandidate,
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "../staffing-suggestion.service";
import { type EffectiveWorkPolicy, WorkPolicyService } from "../work-policy.service";

const weeklyRequirements = vi.hoisted(() => new Map<string, Record<string, number>>());

vi.mock("@/lib/calendar/work-policy-requirements", async () => {
	const { Effect } = await import("effect");
	return {
		loadDailyWorkRequirementsForEmployee: (params: { employeeId: string }) =>
			Effect.succeed(
				Object.fromEntries(
					Object.entries(weeklyRequirements.get(params.employeeId) ?? {}).map(([day, minutes]) => [
						day,
						{ requiredMinutes: minutes, policyId: "policy", policyName: "Policy" },
					]),
				),
			),
	};
});

const TZ = "Europe/Berlin";
const policies = new Map<string, Partial<EffectiveWorkPolicy>>();

const workPolicyLayer = Layer.succeed(WorkPolicyService, {
	getEffectivePolicyAt: (input: { employeeId: string }) =>
		Effect.succeed(policies.get(input.employeeId) ?? null),
} as never);

const serviceLayer = StaffingSuggestionServiceLive.pipe(
	Layer.provide(workPolicyLayer),
	Layer.provide(DatabaseServiceLive),
);

function regulation(values: Record<string, number>) {
	return {
		maxDailyMinutes: null,
		minRestPeriodMinutes: null,
		overtimeDailyThresholdMinutes: null,
		overtimeWeeklyThresholdMinutes: null,
		overtimeMonthlyThresholdMinutes: null,
		...values,
	} as unknown as EffectiveWorkPolicy["regulation"];
}

const WEEKLY_SCHEDULE = { scheduleCycle: "weekly" } as EffectiveWorkPolicy["schedule"];

describe("staffing suggestions", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		policies.clear();
		weeklyRequirements.clear();
	});

	function suggest(
		org: ShiftTestOrganization,
		candidates: StaffingCandidate[],
		shift: Partial<StaffingShiftInput> = {},
	) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.organizationId,
					timezone: TZ,
					candidates,
					shift: {
						subareaId: org.subareaId,
						date: SHIFT_DAY,
						startTime: "08:00",
						endTime: "16:00",
						...shift,
					},
				});
			}).pipe(Effect.provide(serviceLayer)),
		);
	}

	function candidate(person: SeededEmployee, displayName: string): StaffingCandidate {
		return { employeeId: person.employeeId, displayName, isActive: true };
	}

	function stored(date: string) {
		return shiftStoredDate(date, TZ).toISOString();
	}

	async function absence(
		org: ShiftTestOrganization,
		person: SeededEmployee,
		input: {
			startDate: string;
			startPeriod?: "full_day" | "am" | "pm";
			endDate?: string;
			endPeriod?: "full_day" | "am" | "pm";
			status: "approved" | "pending";
			requiresWorkTime?: boolean;
		},
	) {
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time, updated_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[
				categoryId,
				org.organizationId,
				input.requiresWorkTime ? "home_office" : "vacation",
				`Category ${categoryId}`,
				input.requiresWorkTime ?? false,
			],
		);
		await fixture.pool.query(
			`insert into absence_entry
			 (id, employee_id, category_id, start_date, start_period, end_date, end_period, status, organization_id, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
			[
				randomUUID(),
				person.employeeId,
				categoryId,
				input.startDate,
				input.startPeriod ?? "full_day",
				input.endDate ?? input.startDate,
				input.endPeriod ?? input.startPeriod ?? "full_day",
				input.status,
				org.organizationId,
			],
		);
	}

	async function skill(org: ShiftTestOrganization, name: string, isRequired: boolean) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into skill (id, organization_id, name, category, created_by, updated_at)
			 values ($1, $2, $3, 'certification', $4, now())`,
			[id, org.organizationId, name, org.creator.userId],
		);
		await fixture.pool.query(
			`insert into subarea_skill_requirement (id, subarea_id, skill_id, is_required, created_by)
			 values ($1, $2, $3, $4, $5)`,
			[randomUUID(), org.subareaId, id, isRequired, org.creator.userId],
		);
		return id;
	}

	async function holdSkill(
		org: ShiftTestOrganization,
		person: SeededEmployee,
		skillId: string,
		expiresAt: string | null,
	) {
		await fixture.pool.query(
			`insert into employee_skill (id, employee_id, skill_id, expires_at, assigned_by)
			 values ($1, $2, $3, $4, $5)`,
			[
				randomUUID(),
				person.employeeId,
				skillId,
				expiresAt ? new Date(expiresAt) : null,
				org.creator.userId,
			],
		);
	}

	async function workPeriod(
		org: ShiftTestOrganization,
		person: SeededEmployee,
		date: string,
		startTime: string,
		endTime: string,
	) {
		const start = Temporal.ZonedDateTime.from(`${date}T${startTime}[${TZ}]`);
		const end = Temporal.ZonedDateTime.from(`${date}T${endTime}[${TZ}]`);
		const clockInId = randomUUID();
		await fixture.pool.query(
			`insert into time_entry (
				id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone, timezone_source, hash, created_by, created_at
			 ) values ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
			[
				clockInId,
				person.employeeId,
				org.organizationId,
				dateFromInstant(start.toInstant()),
				start.offsetNanoseconds / 60_000_000_000,
				TZ,
				`t796-${clockInId}`,
				person.userId,
			],
		);
		await fixture.pool.query(
			`insert into work_period (
				id, employee_id, organization_id, clock_in_id,
				start_time, end_time, duration_minutes, is_active, updated_at
			 ) values ($1, $2, $3, $4, $5, $6, $7, false, $5)`,
			[
				randomUUID(),
				person.employeeId,
				org.organizationId,
				clockInId,
				dateFromInstant(start.toInstant()),
				dateFromInstant(end.toInstant()),
				start.until(end).total("minutes"),
			],
		);
	}

	function ids(suggestions: Array<{ employeeId: string }>) {
		return suggestions.map((suggestion) => suggestion.employeeId);
	}

	it("leaves out each blocked employee and anyone outside the organization", async () => {
		const org = await fixture.organization(TZ);
		const otherOrg = await fixture.organization(TZ);
		const free = await fixture.seedEmployee({ organizationId: org.organizationId });
		const afternoonOff = await fixture.seedEmployee({ organizationId: org.organizationId });
		const homeOffice = await fixture.seedEmployee({ organizationId: org.organizationId });
		const nightShift = await fixture.seedEmployee({ organizationId: org.organizationId });
		const inactive = await fixture.seedEmployee({
			organizationId: org.organizationId,
			isActive: false,
		});
		const notYetEmployed = await fixture.seedEmployee({ organizationId: org.organizationId });
		const outsider = await fixture.seedEmployee({ organizationId: otherOrg.organizationId });

		await absence(org, afternoonOff, {
			startDate: SHIFT_DAY,
			startPeriod: "pm",
			status: "approved",
		});
		await absence(org, homeOffice, {
			startDate: SHIFT_DAY,
			status: "approved",
			requiresWorkTime: true,
		});
		await fixture.shift(org, {
			employeeId: nightShift.employeeId,
			stored: stored("2026-10-08"),
			startTime: "22:00",
			endTime: "06:00",
			status: "draft",
		});
		await fixture.pool.query(
			"update employee_employment_period set started_at = $2 where employee_id = $1",
			[notYetEmployed.employeeId, new Date("2026-11-01T00:00:00Z")],
		);

		const candidates = [
			candidate(free, "Free"),
			candidate(afternoonOff, "Afternoon off"),
			candidate(homeOffice, "Home office"),
			candidate(nightShift, "Night shift"),
			{ ...candidate(inactive, "Inactive"), isActive: false },
			candidate(notYetEmployed, "Not yet employed"),
			candidate(outsider, "Outsider"),
		];

		const earlyShift = await suggest(org, candidates, { startTime: "05:00", endTime: "11:00" });
		const afternoonShift = await suggest(org, candidates, { startTime: "13:00", endTime: "17:00" });

		expect(ids(earlyShift).toSorted()).toEqual(
			[free, afternoonOff, homeOffice].map((person) => person.employeeId).toSorted(),
		);
		expect(ids(afternoonShift).toSorted()).toEqual(
			[free, homeOffice, nightShift].map((person) => person.employeeId).toSorted(),
		);
	});

	it("leaves the saved shift itself out of the overlap check", async () => {
		const org = await fixture.organization(TZ);
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		const shiftId = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: stored(SHIFT_DAY),
		});

		const withoutId = await suggest(org, [candidate(person, "Person")]);
		const withId = await suggest(org, [candidate(person, "Person")], { shiftId });

		expect(withoutId).toEqual([]);
		expect(ids(withId)).toEqual([person.employeeId]);
	});

	it("warns about a pending absence without leaving the employee out", async () => {
		const org = await fixture.organization(TZ);
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		// A pending absence warns in any category, a work-time one included.
		await absence(org, person, { startDate: SHIFT_DAY, status: "pending", requiresWorkTime: true });

		const [suggestion] = await suggest(org, [candidate(person, "Person")]);

		expect(suggestion.warnings).toEqual([
			expect.objectContaining({ type: "pendingAbsence", startDate: SHIFT_DAY, endDate: SHIFT_DAY }),
		]);
	});

	it("judges skills as of the shift date and ranks qualified employees first", async () => {
		const org = await fixture.organization(TZ);
		const firstAid = await skill(org, "First aid", true);
		const french = await skill(org, "French", false);
		const qualified = await fixture.seedEmployee({ organizationId: org.organizationId });
		const expiring = await fixture.seedEmployee({ organizationId: org.organizationId });
		const untrained = await fixture.seedEmployee({ organizationId: org.organizationId });
		await holdSkill(org, qualified, firstAid, null);
		await holdSkill(org, qualified, french, null);
		// Valid today (2026-10-10), expired by the shift on 2026-10-20.
		await holdSkill(org, expiring, firstAid, "2026-10-15T00:00:00Z");

		const suggestions = await suggest(
			org,
			[candidate(untrained, "Anna"), candidate(expiring, "Bruno"), candidate(qualified, "Carla")],
			{ date: "2026-10-20" },
		);

		expect(suggestions.map((suggestion) => suggestion.displayName)).toEqual([
			"Carla",
			"Anna",
			"Bruno",
		]);
		expect(suggestions[0]).toMatchObject({
			warnings: [],
			notes: [],
			reasons: [
				{ type: "skillsHeld", skillNames: ["First aid", "French"] },
				{ type: "noContractedTarget" },
			],
		});
		expect(suggestions[1].warnings).toEqual([
			{ type: "missingRequiredSkill", skillId: firstAid, skillName: "First aid" },
		]);
		expect(suggestions[2].warnings).toEqual([
			{
				type: "expiredRequiredSkill",
				skillId: firstAid,
				skillName: "First aid",
				expiresAt: "2026-10-15T00:00:00Z",
			},
		]);
		expect(suggestions[2].notes).toEqual([
			{ type: "missingPreferredSkill", skillId: french, skillName: "French" },
		]);
	});

	it("judges compliance by each candidate's own regulation and reports only added findings", async () => {
		const org = await fixture.organization(TZ);
		const strict = await fixture.seedEmployee({ organizationId: org.organizationId });
		const lenient = await fixture.seedEmployee({ organizationId: org.organizationId });
		const alreadyOver = await fixture.seedEmployee({ organizationId: org.organizationId });
		policies.set(strict.employeeId, { regulation: regulation({ maxDailyMinutes: 480 }) });
		policies.set(lenient.employeeId, { regulation: regulation({ maxDailyMinutes: 660 }) });
		policies.set(alreadyOver.employeeId, {
			regulation: regulation({ overtimeWeeklyThresholdMinutes: 600, minRestPeriodMinutes: 660 }),
		});
		// Monday and Tuesday of the shift's week already exceed the weekly threshold.
		await fixture.shift(org, { employeeId: alreadyOver.employeeId, stored: stored("2026-10-05") });
		await workPeriod(org, alreadyOver, "2026-10-06", "08:00", "16:00");

		const suggestions = await suggest(
			org,
			[candidate(strict, "Strict"), candidate(lenient, "Lenient"), candidate(alreadyOver, "Over")],
			{ startTime: "07:00", endTime: "17:00" },
		);

		const byName = new Map(suggestions.map((suggestion) => [suggestion.displayName, suggestion]));
		expect(byName.get("Strict")?.warnings).toEqual([
			{
				type: "compliance",
				findingType: "maxHours",
				finding: expect.objectContaining({
					day: SHIFT_DAY,
					totalMinutes: 600,
					maxDailyMinutes: 480,
				}),
			},
		]);
		expect(byName.get("Lenient")?.warnings).toEqual([]);
		expect(byName.get("Over")?.warnings).toEqual([]);
		expect(byName.get("Over")?.reasons).toContainEqual({ type: "restPeriodOk" });
		expect(suggestions.at(-1)?.displayName).toBe("Strict");
	});

	it("counts planned shifts from the start of the month toward monthly overtime", async () => {
		const org = await fixture.organization(TZ);
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		policies.set(person.employeeId, {
			regulation: regulation({ overtimeMonthlyThresholdMinutes: 1000 }),
		});
		// Both lie in October but before the shift's ISO week (from Monday 2026-10-05).
		await fixture.shift(org, { employeeId: person.employeeId, stored: stored("2026-10-01") });
		await fixture.shift(org, { employeeId: person.employeeId, stored: stored("2026-10-02") });

		const [suggestion] = await suggest(org, [candidate(person, "Person")]);

		expect(suggestion.warnings).toEqual([
			{
				type: "compliance",
				findingType: "overtime",
				finding: expect.objectContaining({
					period: "monthly",
					periodKey: "2026-10",
					totalMinutes: 3 * 480,
				}),
			},
		]);
	});

	it("marks pickup requesters and ranks them before remaining contracted hours", async () => {
		const org = await fixture.organization(TZ);
		const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
		const mostHours = await fixture.seedEmployee({ organizationId: org.organizationId });
		const hourly = await fixture.seedEmployee({ organizationId: org.organizationId });
		const openShiftId = await fixture.shift(org, { employeeId: null, stored: stored(SHIFT_DAY) });
		await fixture.pool.query(
			`insert into shift_request (id, organization_id, shift_id, type, status, requester_id, updated_at)
			 values ($1, $2, $3, 'pickup', 'pending', $4, now())`,
			[randomUUID(), org.organizationId, openShiftId, requester.employeeId],
		);
		await fixture.pool.query("update employee set contract_type = 'hourly' where id = $1", [
			hourly.employeeId,
		]);
		for (const person of [requester, mostHours, hourly]) {
			policies.set(person.employeeId, { schedule: WEEKLY_SCHEDULE, regulation: null });
		}
		const fullWeek = Object.fromEntries(
			["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((day) => [
				day,
				480,
			]),
		);
		weeklyRequirements.set(requester.employeeId, fullWeek);
		weeklyRequirements.set(mostHours.employeeId, fullWeek);
		// The requester already has Monday planned; a draft counts too.
		await fixture.shift(org, {
			employeeId: requester.employeeId,
			stored: stored("2026-10-05"),
			status: "draft",
		});

		const suggestions = await suggest(
			org,
			[
				candidate(hourly, "Hourly"),
				candidate(mostHours, "Most hours"),
				candidate(requester, "Requester"),
			],
			{ shiftId: openShiftId },
		);

		expect(suggestions.map((suggestion) => suggestion.displayName)).toEqual([
			"Requester",
			"Most hours",
			"Hourly",
		]);
		expect(suggestions[0]).toMatchObject({
			requestedThisShift: true,
			remainingContractedMinutes: 2400 - 480,
			reasons: [
				{ type: "plannedHours", plannedMinutes: 480, targetMinutes: 2400 },
				{ type: "requestedThisShift" },
			],
		});
		expect(suggestions[1]).toMatchObject({
			requestedThisShift: false,
			remainingContractedMinutes: 2400,
		});
		expect(suggestions[2]).toMatchObject({
			remainingContractedMinutes: null,
			reasons: [{ type: "noContractedTarget" }],
		});
	});

	it("refuses a subarea of another organization", async () => {
		const org = await fixture.organization(TZ);
		const otherOrg = await fixture.organization(TZ);
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });

		await expect(
			suggest(org, [candidate(person, "Person")], { subareaId: otherOrg.subareaId }),
		).rejects.toMatchObject({ _tag: "NotFoundError" });
	});
});
