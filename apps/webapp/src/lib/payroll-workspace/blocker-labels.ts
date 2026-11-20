import type { PayrollBlocker } from "./types";

/** A Tolgee `t` as the workspace and the payroll PDF call it. */
export type PayrollLabelTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

/**
 * The translated name of a payroll blocker's type, shared by the workspace's blocker
 * list and the payroll PDF. A day changed since settled (#1897) reads like
 * "+1.5 h since settled", with the hours formatted for `locale`.
 */
export function payrollBlockerTypeLabel(
	blocker: Pick<PayrollBlocker, "type" | "settledChange">,
	locale: string,
	t: PayrollLabelTranslate,
): string {
	switch (blocker.type) {
		case "missing_clock_out":
			return t("payroll.blockers.missingClockOut", "Missing clock-out");
		case "unresolved_work_minutes":
			return t("payroll.blockers.unresolvedWorkMinutes", "Work minutes need review");
		case "offboarding_clock_repair":
			return t("payroll.blockers.offboardingClockRepair", "Offboarding clock-out needs repair");
		case "open_work":
			return t("payroll.blockers.openWork", "Work without clock-out");
		case "pending_work_approval":
			return t("payroll.blockers.pendingWorkApproval", "Work awaiting approval");
		case "pending_work_correction":
		case "pending_time_correction":
			return t("payroll.blockers.pendingTimeCorrection", "Pending time correction");
		case "uncertain_historical_work":
			return t("payroll.blockers.uncertainHistoricalWork", "Historical work needs review");
		case "pending_absence":
			return t("payroll.blockers.pendingAbsence", "Pending absence");
		case "missing_identifier":
			return t("payroll.blockers.missingIdentifier", "Missing identifier");
		case "changed_since_settled":
			return changedSinceSettledLabel(blocker.settledChange, locale, t);
	}
}

function changedSinceSettledLabel(
	change: PayrollBlocker["settledChange"],
	locale: string,
	t: PayrollLabelTranslate,
): string {
	if (!change) return t("payroll.blockers.changedSinceSettled", "Changed since settled");
	const hours =
		change.creditedMinutesDifference === 0
			? null
			: new Intl.NumberFormat(locale, {
					maximumFractionDigits: 2,
					signDisplay: "exceptZero",
				}).format(change.creditedMinutesDifference / 60);
	if (hours && change.absencesChanged) {
		return t(
			"payroll.blockers.changedSinceSettledHoursAndAbsence",
			"{hours} h and absence changed since settled",
			{ hours },
		);
	}
	if (hours) {
		return t("payroll.blockers.changedSinceSettledHours", "{hours} h since settled", { hours });
	}
	return t("payroll.blockers.changedSinceSettledAbsence", "Absence changed since settled");
}
