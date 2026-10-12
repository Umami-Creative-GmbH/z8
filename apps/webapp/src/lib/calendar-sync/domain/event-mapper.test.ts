import { describe, expect, it } from "vitest";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { mapAbsenceToCalendarEvent, mapAbsenceToICSEvent } from "./event-mapper";

const sickLeave: AbsenceWithCategory = {
	id: "absence-1",
	employeeId: "employee-1",
	startDate: "2026-10-12",
	startPeriod: "full_day",
	endDate: "2026-10-14",
	endPeriod: "full_day",
	status: "approved",
	notes: null,
	sickDetail: "with_certificate",
	category: {
		id: "category-sick",
		name: "Sick leave",
		type: "sick",
		color: null,
		countsAgainstVacation: false,
	},
	approvedBy: null,
	approvedAt: null,
	rejectionReason: null,
	createdAt: new Date("2026-10-12T07:00:00Z"),
};

describe("calendar events of sick leave (#982)", () => {
	it("never carry the sick detail or that a sick note is attached", () => {
		const options = { organizationId: "org-1", employeeName: "Anna Example" };
		for (const event of [
			mapAbsenceToCalendarEvent(sickLeave, options),
			mapAbsenceToICSEvent(sickLeave, options),
			mapAbsenceToICSEvent(sickLeave, { ...options, includeEmployeeName: true }),
		]) {
			const payload = JSON.stringify(event).toLowerCase();
			expect(payload).not.toContain("certificate");
			expect(payload).not.toContain("sick note");
		}
	});
});
