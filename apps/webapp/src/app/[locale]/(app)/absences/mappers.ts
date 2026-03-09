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
		category: {
			id: absence.category.id,
			name: absence.category.name,
			type: absence.category.type,
			color: absence.category.color,
			countsAgainstVacation: absence.category.countsAgainstVacation,
		},
		approvedBy: absence.approvedBy,
		approvedAt: absence.approvedAt,
		rejectionReason: absence.rejectionReason,
		createdAt: absence.createdAt,
	};
}
