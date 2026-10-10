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

describe("absence plan preview shifts", () => {
	let fixture: ShiftDatabaseFixture;

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
					date: SHIFT_DAY,
					startTime: "08:00",
					endTime: "16:00",
				},
			]);
			expect(result.data.coverage).toEqual({
				hasConfiguredRulesForAffectedShifts: true,
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
});
