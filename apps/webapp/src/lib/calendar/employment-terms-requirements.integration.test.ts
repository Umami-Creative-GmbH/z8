/**
 * PostgreSQL regressions for #1159, through the public requirement and staffing readers.
 * Expected minutes are worked examples from the agreed calendar-date contract.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organization } from "@/db/auth-schema";
import {
	employeeEmploymentHistory,
	organizationTrackingSettings,
	userSettings,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
} from "@/db/schema";
import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { SeededEmployee } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import { loadStaffingRankingFacts } from "@/lib/scheduling/staffing/load-staffing-facts";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import {
	computeEmployeeWorkBalanceAtEndOfDay,
	loadWorkBalanceEmployee,
} from "@/lib/work-balance/service";
import { getDailyWorkRequirementsForEmployee } from "./work-policy-requirements";

const TIMEZONES = ["UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo"];
type ContractType = "fixed" | "hourly";

function dayStart(day: string, timezone: string): Date {
	return dateFromInstant(parsePlainDate(day).toZonedDateTime(timezone).toInstant());
}

describe("employment terms calendar-day ownership", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedPolicy(org: ShiftTestOrganization, scheduleCycle: "weekly" | "monthly" = "weekly") {
		const id = randomUUID();
		await fixture.db.insert(workPolicy).values({
			id,
			organizationId: org.organizationId,
			name: id,
			createdBy: org.creator.userId,
			updatedAt: new Date(),
		});
		await fixture.db.insert(workPolicySchedule).values({
			policyId: id,
			scheduleCycle,
			scheduleType: "simple",
			workingDaysPreset: "all_days",
			hoursPerCycle: "56",
			updatedAt: new Date(),
		});
		return id;
	}

	async function seedTerms(
		org: ShiftTestOrganization,
		person: SeededEmployee,
		input: {
			from: string;
			until?: string;
			contractType?: ContractType;
			minutes?: number;
			policyId: string | null;
			reviewState?: "confirmed" | "draft" | "pending";
			organizationId?: string;
		},
	) {
		const id = randomUUID();
		await fixture.db.insert(employeeEmploymentHistory).values({
			id,
			organizationId: input.organizationId ?? org.organizationId,
			employeeId: person.employeeId,
			employmentPeriodId: input.organizationId ? null : person.employmentPeriodId,
			validFrom: new Date(input.from + "T00:00:00Z"),
			validUntil: input.until ? new Date(input.until + "T00:00:00Z") : null,
			contractType: input.contractType ?? "fixed",
			weeklyContractMinutes: input.minutes ?? 3360,
			workPolicyId: input.policyId,
			reviewState: input.reviewState ?? "confirmed",
			createdBy: org.creator.userId,
			updatedAt: new Date(),
		});
		return id;
	}

	async function scenario(
		timezone: string,
		input: {
			boundary?: string;
			oldContract?: ContractType;
			newContract?: ContractType;
			organizationTimezone?: string;
		} = {},
	) {
		const org = await fixture.organization("UTC");
		await fixture.db.update(organization)
			.set({ timezone: input.organizationTimezone ?? timezone })
			.where(eq(organization.id, org.organizationId));
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.db.insert(userSettings).values({
			userId: person.userId,
			timezone,
			updatedAt: new Date(),
		});
		await fixture.db.insert(organizationTrackingSettings).values({
			organizationId: org.organizationId,
			trackingStartDate: "2026-01-02",
			activatedAt: new Date("2026-01-02T00:00:00Z"),
		});
		const policyId = await seedPolicy(org);
		await fixture.db.insert(workPolicyAssignment).values({
			policyId,
			organizationId: org.organizationId,
			assignmentType: "employee",
			employeeId: person.employeeId,
			priority: 2,
			createdBy: org.creator.userId,
			updatedAt: new Date(),
		});
		const boundary = input.boundary ?? "2026-01-15";
		const oldTermsId = await seedTerms(org, person, {
			from: "2026-01-02",
			until: boundary,
			contractType: input.oldContract,
			policyId,
		});
		const newTermsId = await seedTerms(org, person, {
			from: boundary,
			contractType: input.newContract,
			minutes: 1680,
			policyId,
		});
		const scope = { organizationId: org.organizationId, employeeId: person.employeeId };
		return { org, person, policyId, oldTermsId, newTermsId, boundary, timezone, scope };
	}

	type Scenario = Awaited<ReturnType<typeof scenario>>;

	function requirements(subject: Scenario, from: string, through = from, viewerTimezone = "UTC") {
		return getDailyWorkRequirementsForEmployee({
			...subject.scope,
			startDate: dayStart(from, subject.timezone),
			endDate: dayStart(through, subject.timezone),
			timezone: viewerTimezone,
		}, fixture.db);
	}

	function minutesByDay(result: Awaited<ReturnType<typeof requirements>>) {
		return Object.fromEntries(
			Object.entries(result).map(([day, requirement]) => [day, requirement.requiredMinutes]),
		);
	}

	it.each(TIMEZONES)("gives the boundary day to the new terms only in %s", async (timezone) => {
		const subject = await scenario(timezone);
		const wide = await requirements(subject, "2026-01-14", "2026-01-16");
		const boundaryOnly = await requirements(subject, "2026-01-15");

		expect(minutesByDay(wide)).toEqual({
			"2026-01-14": 480,
			"2026-01-15": 240,
			"2026-01-16": 240,
		});
		expect(minutesByDay(boundaryOnly)).toEqual({ "2026-01-15": 240 });
	});

	it("uses the employee calendar when organization and viewer timezones differ", async () => {
		const subject = await scenario("America/New_York", { organizationTimezone: "Asia/Tokyo" });

		expect(minutesByDay(await requirements(subject, "2026-01-14", "2026-01-15", "Europe/Berlin")))
			.toEqual({ "2026-01-14": 480, "2026-01-15": 240 });
	});

	it.each([
		{ timezone: "Europe/Berlin", boundary: "2026-03-29", before: "2026-03-28", after: "2026-03-30" },
		{ timezone: "America/New_York", boundary: "2026-11-01", before: "2026-10-31", after: "2026-11-02" },
	])("keeps consecutive dates at the $timezone DST boundary", async ({ timezone, boundary, before, after }) => {
		const subject = await scenario(timezone, { boundary });

		expect(minutesByDay(await requirements(subject, before, after))).toEqual({
			[before]: 480,
			[boundary]: 240,
			[after]: 240,
		});
	});

	it.each(TIMEZONES.flatMap((timezone) => [
		{ timezone, oldContract: "fixed" as const, newContract: "hourly" as const },
		{ timezone, oldContract: "hourly" as const, newContract: "fixed" as const },
	]))("selects one source for $oldContract to $newContract in $timezone", async (input) => {
		const subject = await scenario(input.timezone, input);
		for (const day of ["2026-01-14", "2026-01-15"]) {
			await fixture.shift(subject.org, {
				employeeId: subject.person.employeeId,
				stored: shiftStoredDate(day, input.timezone).toISOString(),
				startTime: "08:00",
				endTime: "11:00",
			});
		}
		const result = await requirements(subject, "2026-01-14", "2026-01-15");

		expect(minutesByDay(result)).toEqual({
			"2026-01-14": input.oldContract === "hourly" ? 180 : 480,
			"2026-01-15": input.newContract === "hourly" ? 180 : 240,
		});
	});

	it("ignores draft, pending and other-organization terms", async () => {
		const subject = await scenario("Europe/Berlin");
		const foreign = await fixture.organization("UTC");
		for (const reviewState of ["draft", "pending"] as const) {
			await seedTerms(subject.org, subject.person, {
				from: "2026-01-16",
				contractType: "hourly",
				policyId: null,
				reviewState,
			});
		}
		await seedTerms(subject.org, subject.person, {
			from: "2026-01-16",
			contractType: "hourly",
			policyId: null,
			organizationId: foreign.organizationId,
		});

		expect(minutesByDay(await requirements(subject, "2026-01-16")))
			.toEqual({ "2026-01-16": 240 });
		expect(await getDailyWorkRequirementsForEmployee({
			organizationId: foreign.organizationId,
			employeeId: subject.person.employeeId,
			startDate: dayStart("2026-01-16", "Europe/Berlin"),
			endDate: dayStart("2026-01-16", "Europe/Berlin"),
		}, fixture.db)).toEqual({});
	});

	it("does not use another organization's policy", async () => {
		const subject = await scenario("Europe/Berlin");
		const foreign = await fixture.organization("UTC");
		const foreignPolicy = await seedPolicy(foreign);
		await fixture.db.update(employeeEmploymentHistory)
			.set({ workPolicyId: foreignPolicy })
			.where(eq(employeeEmploymentHistory.id, subject.newTermsId));

		expect(await requirements(subject, "2026-01-15")).toEqual({});
	});

	it("keeps the assigned-policy fallback when no confirmed terms cover the requested dates", async () => {
		const subject = await scenario("America/New_York");
		await fixture.db.delete(employeeEmploymentHistory)
			.where(eq(employeeEmploymentHistory.employeeId, subject.person.employeeId));

		expect(minutesByDay(await requirements(subject, "2026-01-15")))
			.toEqual({ "2026-01-15": 480 });
	});

	it("uses corrected required time in a fresh work-balance calculation", async () => {
		const subject = await scenario("Europe/Berlin");
		const person = await loadWorkBalanceEmployee(subject.scope, fixture.db);
		expect(person).not.toBeNull();
		if (!person) throw new Error("Missing seeded employee");

		expect(await computeEmployeeWorkBalanceAtEndOfDay({
			organizationId: subject.org.organizationId,
			employee: person,
			day: "2026-01-15",
			trackingStartDateOverride: "2026-01-14",
		}, fixture.db)).toBe(-720);
	});

	it.each(TIMEZONES)("uses the shift date to select staffing terms in %s", async (timezone) => {
		const subject = await scenario(timezone, {
			newContract: "hourly",
			organizationTimezone: timezone,
		});
		const monthlyPolicy = await seedPolicy(subject.org, "monthly");
		await fixture.db.update(employeeEmploymentHistory)
			.set({ workPolicyId: monthlyPolicy })
			.where(eq(employeeEmploymentHistory.id, subject.newTermsId));
		const second = await fixture.seedEmployee({ organizationId: subject.org.organizationId });
		await seedTerms(subject.org, second, {
			from: "2026-01-15",
			contractType: "hourly",
			policyId: null,
		});
		const foreign = await fixture.organization("UTC");
		await seedTerms(subject.org, subject.person, {
			from: "2026-01-15",
			policyId: null,
			organizationId: foreign.organizationId,
		});
		await seedTerms(subject.org, subject.person, {
			from: "2026-01-15",
			policyId: null,
			reviewState: "draft",
		});
		await seedTerms(subject.org, subject.person, {
			from: "2026-01-15",
			policyId: null,
			reviewState: "pending",
		});

		async function staffing(day: string) {
			return loadStaffingRankingFacts(fixture.db, {
				organizationId: subject.org.organizationId,
				employeeIds: [subject.person.employeeId, second.employeeId],
				timezone,
				shiftDate: parsePlainDate(day),
				shiftsFrom: parsePlainDate("2026-01-12"),
				until: parsePlainDate("2026-01-19"),
				excludeShiftId: null,
			});
		}

		const before = await staffing("2026-01-14");
		const onBoundary = await staffing("2026-01-15");

		expect(before.get(subject.person.employeeId)?.contract).toEqual({
			contractType: "fixed",
			termsScheduleCycle: { cycle: "weekly" },
		});
		expect(onBoundary.get(subject.person.employeeId)?.contract).toEqual({
			contractType: "hourly",
			termsScheduleCycle: { cycle: "monthly" },
		});
		expect(onBoundary.get(second.employeeId)?.contract).toEqual({
			contractType: "hourly",
			termsScheduleCycle: null,
		});
	});
});
