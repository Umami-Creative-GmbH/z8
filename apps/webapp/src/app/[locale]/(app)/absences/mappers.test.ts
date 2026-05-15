import { describe, expect, it } from "vitest";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { mapAbsenceWithCategory } from "./mappers";

function buildAbsence(overrides: Partial<AbsenceWithCategory> = {}): AbsenceWithCategory {
	return {
		id: "absence-1",
		employeeId: "employee-1",
		startDate: "2026-05-18",
		startPeriod: "full_day",
		endDate: "2026-05-18",
		endPeriod: "full_day",
		status: "approved",
		notes: null,
		sickDetail: null,
		category: {
			id: "category-1",
			name: "Vacation",
			type: "vacation",
			color: null,
			countsAgainstVacation: true,
		},
		approvedBy: null,
		approvedAt: null,
		rejectionReason: null,
		createdAt: new Date("2026-05-01T00:00:00.000Z"),
		...overrides,
	};
}

describe("mapAbsenceWithCategory", () => {
	it("redacts stale sick detail from non-sick absences", () => {
		const mapped = mapAbsenceWithCategory(
			buildAbsence({
				sickDetail: "with_certificate",
				category: {
					id: "category-vacation",
					name: "Vacation",
					type: "vacation",
					color: null,
					countsAgainstVacation: true,
				},
			}),
		);

		expect(mapped.sickDetail).toBeNull();
	});

	it("preserves sick detail for sick absences", () => {
		const mapped = mapAbsenceWithCategory(
			buildAbsence({
				sickDetail: "with_certificate",
				category: {
					id: "category-sick",
					name: "Sick",
					type: "sick",
					color: null,
					countsAgainstVacation: false,
				},
			}),
		);

		expect(mapped.sickDetail).toBe("with_certificate");
	});
});
