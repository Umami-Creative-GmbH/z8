import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

/**
 * Review rows of an expense's frozen project attribution (#605): the project
 * as named at submission and how the employee's use of it on the expense date
 * was proven. An attribution exception is spelled out with its reason and
 * evidence, never reduced to a label.
 */
export function travelExpenseReportProjectRows(item: TravelExpenseReportSubmittedItem): Row[] {
	const { project } = item;
	if (!project) return [];
	const name = [project.name, project.customerName].filter(Boolean).join(" · ");
	const rows: Row[] = [
		{
			label: text("project", "Project"),
			value: project.inheritedFromTrip ? `${name} (trip project)` : name,
		},
	];
	if (project.basis === "exception" && project.exception) {
		const { validFrom, validTo, reason, evidence } = project.exception;
		rows.push(
			{
				label: text("projectBasis", "Project eligibility"),
				value: text(
					"projectBasisException",
					"Authorized attribution exception — not proven by assignment history",
				),
			},
			{
				label: text("projectExceptionDates", "Exception covers"),
				value: validFrom === validTo ? validFrom : `${validFrom} – ${validTo}`,
			},
			{ label: text("projectExceptionReason", "Exception reason"), value: reason },
			{ label: text("projectExceptionEvidence", "Exception evidence"), value: evidence },
		);
	} else {
		rows.push({
			label: text("projectBasis", "Project eligibility"),
			value:
				project.basis === "team_assignment"
					? text("projectBasisTeam", "Team assigned to the project on the expense date")
					: text("projectBasisEmployee", "Assigned to the project on the expense date"),
		});
	}
	return rows;
}
