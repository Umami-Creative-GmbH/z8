import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (
	key: string,
	fallback: string,
	params?: ApprovalInboxLocalizedText["params"],
): ApprovalInboxLocalizedText => ({
	key,
	fallback,
	...(params ? { params } : {}),
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
			label: text("approvals:approvals.evidence.project", "Project"),
			value: project.inheritedFromTrip
				? text("approvals:approvals.evidence.projectInheritedFromTrip", "{name} (trip project)", {
						name,
					})
				: name,
		},
	];
	if (project.basis === "exception" && project.exception) {
		const { validFrom, validTo, reason, evidence } = project.exception;
		rows.push(
			{
				label: text("approvals:approvals.evidence.projectBasis", "Project eligibility"),
				value: text(
					"approvals:approvals.evidence.projectBasisException",
					"Authorized attribution exception — not proven by assignment history",
				),
			},
			{
				label: text("approvals:approvals.evidence.projectExceptionDates", "Exception covers"),
				value: { kind: "plain_date_range", start: validFrom, end: validTo },
			},
			{
				label: text("approvals:approvals.evidence.projectExceptionReason", "Exception reason"),
				value: reason,
			},
			{
				label: text("approvals:approvals.evidence.projectExceptionEvidence", "Exception evidence"),
				value: evidence,
			},
		);
	} else {
		rows.push({
			label: text("approvals:approvals.evidence.projectBasis", "Project eligibility"),
			value:
				project.basis === "team_assignment"
					? text(
							"approvals:approvals.evidence.projectBasisTeam",
							"Team assigned to the project on the expense date",
						)
					: text(
							"approvals:approvals.evidence.projectBasisEmployee",
							"Assigned to the project on the expense date",
						),
		});
	}
	return rows;
}
