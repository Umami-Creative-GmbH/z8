import type { useTranslate } from "@tolgee/react";
import type { WorkPolicyAssignmentWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
type AssignmentType = WorkPolicyAssignmentWithDetails["assignmentType"];

function formatAssignmentEmployeeName(
	employeeRecord: { firstName?: string | null; lastName?: string | null } | null | undefined,
	fallback: string,
) {
	return employeeRecord ? buildAuthUserDisplayName(employeeRecord) || fallback : fallback;
}

type Translate = ReturnType<typeof useTranslate>["t"];

/** Who an assignment applies to, as shown in its row and its removal confirmation. */
export function workPolicyAssignmentTargetLabel(
	assignment: WorkPolicyAssignmentWithDetails,
	t: Translate,
	// A section already knows which level it lists; it passes that level so the label
	// never depends on the row carrying its own type.
	kind: AssignmentType = assignment.assignmentType,
) {
	switch (kind) {
		case "organization":
			return t("settings.workPolicies.orgLevel", "Organization Default");
		case "team":
			return assignment.team?.name || t("common.unknownTeam", "Unknown Team");
		default:
			return formatAssignmentEmployeeName(
				assignment.employee,
				t("common.unknownEmployee", "Unknown Employee"),
			);
	}
}
