import type { AbsenceWithCategory } from "@/lib/absences/types";

export function mapAbsenceWithCategory(absence: AbsenceWithCategory): AbsenceWithCategory {
	return {
		id: absence.id,
		employeeId: absence.employeeId,
		startDate: absence.startDate,
		startPeriod: absence.startPeriod,
		endDate: absence.endDate,
		endPeriod: absence.endPeriod,
		status: absence.status,
		notes: absence.notes,
		sickDetail: absence.category.type === "sick" ? absence.sickDetail : null,
		category: {
			id: absence.category.id,
			name: absence.category.name,
			type: absence.category.type,
			color: absence.category.color,
			countsAgainstVacation: absence.category.countsAgainstVacation,
			deputyRequired: absence.category.deputyRequired ?? false,
		},
		deputy: absence.deputy
			? {
					id: absence.deputy.id,
					name: absence.deputy.name,
					// Whether the viewer may open the deputy's profile (#1012).
					...(absence.deputy.canOpenProfile !== undefined
						? { canOpenProfile: absence.deputy.canOpenProfile }
						: {}),
				}
			: null,
		approvedBy: absence.approvedBy,
		approvedAt: absence.approvedAt,
		rejectionReason: absence.rejectionReason,
		createdAt: absence.createdAt,
	};
}
