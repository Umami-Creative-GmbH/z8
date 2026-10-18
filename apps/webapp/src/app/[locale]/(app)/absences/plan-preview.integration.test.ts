/**
 * PostgreSQL contract (#942): the absence plan preview reads the requester's
 * and their colleagues' shifts of the requested calendar days by the
 * organization-local `shift.date`, and checks coverage rules on that date's
 * weekday. It used to use UTC day bounds and UTC date and weekday keys.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";

const currentEmployee = vi.hoisted(() => ({
	value: null as { id: string; organizationId: string } | null,
}));

vi.mock("./current-employee", () => ({
	getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock("./queries", () => ({
	getHolidays: async () => [],
	getVacationBalance: async () => null,
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: async () => null,
}));

const { getAbsencePlanPreview } = await import("./plan-preview");

let fixture: ShiftDatabaseFixture;

describe("absence plan preview shifts", () => {
	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	beforeEach(() => {
		currentEmployee.value = null;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"previews the %s organization's shifts and coverage of the requested day",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
			const colleague = await fixture.seedEmployee({ organizationId: org.organizationId });
			const categoryId = randomUUID();
			await fixture.pool.query(
				`insert into absence_category
				 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
				 values ($1, $2, 'vacation', 'Leave', true, false, true, now())`,
				[categoryId, org.organizationId],
			);
			// 2026-10-09 is a Friday.
			await fixture.pool.query(
				`insert into coverage_rule
				 (organization_id, subarea_id, day_of_week, start_time, end_time, minimum_staff_count, created_by, updated_at)
				 values ($1, $2, 'friday', '08:00', '16:00', 1, $3, now())`,
				[org.organizationId, org.subareaId, org.creator.userId],
			);
			await fixture.shift(org, { employeeId: requester.employeeId, stored: stored.previous });
			const affected = await fixture.shift(org, {
				employeeId: requester.employeeId,
				stored: stored.day,
			});
			await fixture.shift(org, { employeeId: requester.employeeId, stored: stored.next });
			await fixture.shift(org, {
				employeeId: colleague.employeeId,
				stored: stored.day,
				startTime: "08:00",
				endTime: "12:00",
			});
			// The day before covers the afternoon; it must not count for the requested day.
			await fixture.shift(org, {
				employeeId: colleague.employeeId,
				stored: stored.previous,
				startTime: "12:00",
				endTime: "16:00",
			});
			currentEmployee.value = { id: requester.employeeId, organizationId: org.organizationId };

			const result = await getAbsencePlanPreview({
				categoryId,
				startDate: SHIFT_DAY,
				startPeriod: "full_day",
				endDate: SHIFT_DAY,
				endPeriod: "full_day",
			});

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.affectedShifts).toEqual([
				{
					id: affected,
					subareaId: org.subareaId,
					subareaName: "Floor",
					date: SHIFT_DAY,
					startTime: "08:00",
					endTime: "16:00",
					affectedStartTime: "08:00",
					affectedEndTime: "16:00",
				},
			]);
			expect(result.data.coverage).toEqual({
				status: "complete",
				gaps: [],
				risks: [
					expect.objectContaining({
						date: SHIFT_DAY,
						startTime: "12:00",
						endTime: "16:00",
						minimumStaffCount: 1,
						staffCountAfterAbsence: 0,
					}),
				],
			});
		},
	);

	it("removes the requester only for the hours of a partial-day absence", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
		const categoryId = await seedVacationCategory(org.organizationId);
		await seedRule(org, org.subareaId, "friday", "08:00", "16:00", 1);
		const affected = await fixture.shift(org, {
			employeeId: requester.employeeId,
			stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
		});
		currentEmployee.value = { id: requester.employeeId, organizationId: org.organizationId };

		const result = await getAbsencePlanPreview({
			categoryId,
			startDate: SHIFT_DAY,
			startPeriod: "am",
			endDate: SHIFT_DAY,
			endPeriod: "am",
			durationKind: "partial_day",
			startTime: "10:00",
			endTime: "12:00",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.affectedShifts).toEqual([
			expect.objectContaining({
				id: affected,
				affectedStartTime: "10:00",
				affectedEndTime: "12:00",
			}),
		]);
		expect(result.data.coverage).toEqual({
			status: "complete",
			gaps: [],
			risks: [
				expect.objectContaining({
					date: SHIFT_DAY,
					startTime: "10:00",
					endTime: "12:00",
					minimumStaffCount: 1,
					staffCountAfterAbsence: 0,
				}),
			],
		});
	});

	it("evaluates an overnight shift from the day before, scoped to the organization, without colleague identities", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const otherOrg = await fixture.organization("Europe/Berlin");
		const stored = STORED_SHIFT_DATES["Europe/Berlin"];
		const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
		const colleague = await fixture.seedEmployee({ organizationId: org.organizationId });
		const outsider = await fixture.seedEmployee({ organizationId: otherOrg.organizationId });
		const categoryId = await seedVacationCategory(org.organizationId);
		await seedRule(org, org.subareaId, "friday", "00:00", "06:00", 2);
		// Rows of another organization that name this organization's subarea must not count.
		await seedRule(otherOrg, org.subareaId, "friday", "00:00", "06:00", 5);
		const night = await fixture.shift(org, {
			employeeId: requester.employeeId,
			stored: stored.previous,
			startTime: "22:00",
			endTime: "06:00",
		});
		const colleagueShift = await fixture.shift(org, {
			employeeId: colleague.employeeId,
			stored: stored.previous,
			startTime: "22:00",
			endTime: "06:00",
		});
		const outsiderShift = await fixture.shift(otherOrg, {
			employeeId: outsider.employeeId,
			subareaId: org.subareaId,
			stored: stored.previous,
			startTime: "22:00",
			endTime: "06:00",
		});
		currentEmployee.value = { id: requester.employeeId, organizationId: org.organizationId };

		const result = await getAbsencePlanPreview({
			categoryId,
			startDate: SHIFT_DAY,
			startPeriod: "full_day",
			endDate: SHIFT_DAY,
			endPeriod: "full_day",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.affectedShifts).toEqual([
			expect.objectContaining({
				id: night,
				date: "2026-10-08",
				affectedStartTime: "00:00",
				affectedEndTime: "06:00",
			}),
		]);
		expect(result.data.coverage).toEqual({
			status: "complete",
			gaps: [],
			risks: [
				expect.objectContaining({
					date: SHIFT_DAY,
					startTime: "00:00",
					endTime: "06:00",
					minimumStaffCount: 2,
					staffCountAfterAbsence: 1,
				}),
			],
		});
		const response = JSON.stringify(result);
		for (const hidden of [
			colleague.employeeId,
			colleagueShift,
			outsider.employeeId,
			outsiderShift,
			otherOrg.organizationId,
		]) {
			expect(response).not.toContain(hidden);
		}
	});

	it("refuses a preview with another organization's category", async () => {
		const org = await fixture.organization("UTC");
		const otherOrg = await fixture.organization("UTC");
		const outsider = await fixture.seedEmployee({ organizationId: otherOrg.organizationId });
		const categoryId = await seedVacationCategory(org.organizationId);
		currentEmployee.value = { id: outsider.employeeId, organizationId: otherOrg.organizationId };

		const result = await getAbsencePlanPreview({
			categoryId,
			startDate: SHIFT_DAY,
			startPeriod: "full_day",
			endDate: SHIFT_DAY,
			endPeriod: "full_day",
		});

		expect(result).toEqual({ success: false, error: "Absence category not found" });
	});

	it("shows the requester the projected work balance after time off in lieu, warning when negative", async () => {
		const org = await fixture.organization("UTC");
		const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query("update employee set contract_type = 'hourly' where id = $1", [
			requester.employeeId,
		]);
		await fixture.shift(org, {
			employeeId: requester.employeeId,
			stored: STORED_SHIFT_DATES.UTC.day,
		});
		await fixture.pool.query(
			`insert into employee_work_balance
			 (employee_id, organization_id, actual_minutes, required_minutes, balance_minutes,
				computed_from_date, computed_through_date, computed_at, is_dirty, updated_at)
			 values ($1, $2, 0, 0, 240, '2026-01-01', '2026-10-08', now(), false, now())`,
			[requester.employeeId, org.organizationId],
		);
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation,
				draws_on_work_balance, is_active, updated_at)
			 values ($1, $2, 'time_off_in_lieu', 'Time off in lieu', true, false, true, true, now())`,
			[categoryId, org.organizationId],
		);
		currentEmployee.value = { id: requester.employeeId, organizationId: org.organizationId };

		const result = await getAbsencePlanPreview({
			categoryId,
			startDate: SHIFT_DAY,
			startPeriod: "full_day",
			endDate: SHIFT_DAY,
			endPeriod: "full_day",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.workBalance).toEqual({
			currentBalanceMinutes: 240,
			drawnMinutes: 480,
			projectedBalanceMinutes: -240,
			wouldBeNegative: true,
		});
		expect(result.data.warnings).toContain("Work balance would be negative after this request.");
	});
});

async function seedVacationCategory(organizationId: string) {
	const categoryId = randomUUID();
	await fixture.pool.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $2, 'vacation', 'Leave', true, false, true, now())`,
		[categoryId, organizationId],
	);
	return categoryId;
}

async function seedRule(
	org: ShiftTestOrganization,
	subareaId: string,
	dayOfWeek: string,
	startTime: string,
	endTime: string,
	minimumStaffCount: number,
) {
	await fixture.pool.query(
		`insert into coverage_rule
		 (organization_id, subarea_id, day_of_week, start_time, end_time, minimum_staff_count, created_by, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, now())`,
		[
			org.organizationId,
			subareaId,
			dayOfWeek,
			startTime,
			endTime,
			minimumStaffCount,
			org.creator.userId,
		],
	);
}
