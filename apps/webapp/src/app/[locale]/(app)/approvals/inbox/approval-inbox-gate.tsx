import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { canAccessApprovalInbox } from "@/lib/authorization";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { ApprovalInboxView } from "./approval-inbox-view";

/**
 * Server guard for `/approvals/inbox` (#1976): the same `canAccessApprovalInbox`
 * check as the inbox API, for the active organization's employee. Everyone else
 * leaves before the inbox shell renders.
 */
export async function ApprovalInboxGate() {
	const [authContext, ability] = await Promise.all([getAuthContext(), getAbility()]);
	const currentEmployee = authContext?.employee;
	if (!currentEmployee) return <NoEmployeeError feature="approve requests" />;
	if (!ability || !canAccessApprovalInbox(ability, currentEmployee)) {
		return redirectWithLocale("/");
	}

	return <ApprovalInboxView />;
}
