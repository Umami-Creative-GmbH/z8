import type { useTranslate } from "@tolgee/react";
import type { SupportedPayrollContribution } from "@/lib/payroll-export/supported-output-evidence";
import { payrollUtcTime } from "./payroll-evidence-format";

type Translate = ReturnType<typeof useTranslate>["t"];
export function PayrollSourceFacts({
	contribution,
	t,
}: {
	contribution: SupportedPayrollContribution;
	t: Translate;
}) {
	if (contribution.kind === "work")
		return (
			<>
				<EvidenceFact
					label={t("payroll.baselines.workStart", "Work start (UTC)")}
					value={
						contribution.facts.startAt
							? payrollUtcTime(contribution.facts.startAt)
							: t("payroll.baselines.notRetained", "Not retained")
					}
				/>
				<EvidenceFact
					label={t("payroll.baselines.workEnd", "Work end (UTC)")}
					value={
						contribution.facts.endAt
							? payrollUtcTime(contribution.facts.endAt)
							: t("payroll.baselines.notRetained", "Not retained")
					}
				/>
				<EvidenceFact
					label={t("payroll.baselines.duration", "Duration (minutes)")}
					value={String(contribution.facts.durationMinutes)}
				/>
				<EvidenceFact
					label={t(
						"payroll.baselines.workCategory",
						"Historical work category",
					)}
					value={
						[
							contribution.facts.workCategoryName,
							contribution.facts.workCategoryId,
						]
							.filter(Boolean)
							.join(" · ") || t("payroll.baselines.notRetained", "Not retained")
					}
				/>
				<EvidenceFact
					label={t("payroll.baselines.project", "Historical project")}
					value={
						[contribution.facts.projectName, contribution.facts.projectId]
							.filter(Boolean)
							.join(" · ") || t("payroll.baselines.notRetained", "Not retained")
					}
				/>
			</>
		);
	if (contribution.kind === "absence")
		return (
			<>
				<EvidenceFact
					label={t(
						"payroll.baselines.absencePeriod",
						"Historical absence period",
					)}
					value={`${contribution.facts.startDate} – ${contribution.facts.endDate}`}
				/>
				<EvidenceFact
					label={t(
						"payroll.baselines.absenceCategory",
						"Historical absence category",
					)}
					value={[
						contribution.facts.absenceCategoryName,
						contribution.facts.absenceCategoryId,
					]
						.filter(Boolean)
						.join(" · ")}
				/>
				<EvidenceFact
					label={t("payroll.baselines.absenceType", "Historical absence type")}
					value={
						contribution.facts.absenceType ??
						t("payroll.baselines.notRetained", "Not retained")
					}
				/>
				<EvidenceFact
					label={t(
						"payroll.baselines.absenceStatus",
						"Historical absence status",
					)}
					value={contribution.facts.status}
				/>
			</>
		);
	return (
		<>
			<EvidenceFact
				label={t("payroll.baselines.payoutDay", "Historical payout day")}
				value={contribution.facts.day}
			/>
			<EvidenceFact
				label={t("payroll.baselines.payoutMinutes", "Payout (minutes)")}
				value={String(contribution.facts.minutes)}
			/>
		</>
	);
}
export function EvidenceFact({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<div>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="break-all">{value}</dd>
		</div>
	);
}
