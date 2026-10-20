"use client";
import { useTranslate } from "@tolgee/react";
export function useDrivingHistoryLabels() {
	const { t } = useTranslate();
	const labels: Record<string, string> = {
		authorized: t("drivingLicence.history.authorized", "Authorization granted"),
		suspended: t("drivingLicence.history.suspended", "Authorization suspended"),
		global_suspension: t(
			"drivingLicence.history.globalSuspension",
			"All driving authorization suspended",
		),
		reinstated: t(
			"drivingLicence.history.reinstated",
			"Authorization explicitly reinstated after a new check",
		),
		impediment_reported: t(
			"drivingLicence.history.impedimentReported",
			"Driving impediment reported",
		),
		impediment_resolved: t(
			"drivingLicence.history.impedimentResolved",
			"Reported impediment explicitly resolved",
		),
		ended: t("drivingLicence.history.ended", "Driving authorization ended"),
		policy_interval_changed: t(
			"drivingLicence.history.policyIntervalChanged",
			"Authorization deadline changed by interval policy",
		),
		policy_recalculated: t(
			"drivingLicence.history.policyRecalculated",
			"Authorization deadline recalculated by policy",
		),
	};
	const fields: Record<string, string> = {
		documentIssuedOn: t(
			"drivingLicence.history.documentIssued",
			"Document issue date",
		),
		documentExpiresOn: t(
			"drivingLicence.history.documentExpiry",
			"Document expiry date",
		),
		classExpiry: t("drivingLicence.history.classExpiry", "Class expiry date"),
		classRestrictions: t(
			"drivingLicence.history.classRestrictions",
			"Driving restrictions",
		),
		classResult: t(
			"drivingLicence.history.classResult",
			"Inspected class outcome",
		),
	};
	const outcomes: Record<string, string> = {
		successful: t("drivingLicence.result.successful", "Successful"),
		unsuccessful: t("drivingLicence.result.unsuccessful", "Unsuccessful"),
		inconclusive: t("drivingLicence.result.inconclusive", "Inconclusive"),
	};
	const reasons: Record<string, string> = {
		check_overdue: t("drivingLicence.history.overdue", "Routine check overdue"),
		document_expired: t(
			"drivingLicence.history.documentExpired",
			"Document expired",
		),
		class_expired: t("drivingLicence.history.classExpired", "Class expired"),
		evidence_corrected: t(
			"drivingLicence.history.evidenceCorrected",
			"Corrected evidence requires a new check and explicit reinstatement",
		),
		check_unsuccessful: t(
			"drivingLicence.history.failed",
			"Inspected class unsuccessful",
		),
		check_inconclusive: t(
			"drivingLicence.history.inconclusive",
			"Inspected class inconclusive",
		),
		person_impediment: t(
			"drivingLicence.history.personImpediment",
			"Person-wide impediment",
		),
		document_impediment: t(
			"drivingLicence.history.documentImpediment",
			"Document-wide impediment",
		),
		employment_ended: t(
			"drivingLicence.history.employmentEnded",
			"Employment ended",
		),
		no_longer_intended: t(
			"drivingLicence.history.noLongerIntended",
			"No longer an intended driver",
		),
	};
	return { labels, fields, outcomes, reasons };
}
