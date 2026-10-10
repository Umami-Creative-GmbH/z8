import type { AbsenceDeputyView } from "@/lib/absences/deputy";
import type { ApprovalInboxDetailSection } from "../inbox/types";

type KeyValueSection = Extract<ApprovalInboxDetailSection, { type: "key_value" }>;

const DEPUTY_LABEL = { key: "approvals:approvals.deputy.label", fallback: "Deputy" };

/**
 * Who covers while the employee is away (#1011), so the approver can reject
 * when the cover does not work. The deputy is not part of what is approved;
 * this shows the absence's current deputy.
 */
export function buildAbsenceDeputySection(deputy: AbsenceDeputyView | null): KeyValueSection {
	const rows: KeyValueSection["rows"] = [
		{
			label: DEPUTY_LABEL,
			value: deputy
				? deputy.name
				: { key: "approvals:approvals.deputy.none", fallback: "None named" },
		},
	];
	if (deputy && !deputy.canDecideApprovals) {
		rows.push({
			label: { key: "approvals:approvals.deputy.approvals", fallback: "Approvals" },
			value: {
				key: "approvals:approvals.deputy.contactOnly",
				fallback: "Contact only: cannot decide approvals",
			},
			tone: "warning",
		});
	}
	return {
		type: "key_value",
		title: { key: "approvals:approvals.deputy.title", fallback: "Cover" },
		rows,
	};
}
