import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { PageHeader } from "@/components/ui/page-header";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { canAccessApprovalInbox } from "@/lib/authorization";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";
import { ApprovalInboxView } from "./approval-inbox-view";

/**
 * Server guard for `/approvals/inbox` (#1976): the same `canAccessApprovalInbox`
 * check as the inbox API, for the active organization's employee. Everyone else
 * leaves before the inbox shell renders.
 */
export async function ApprovalInboxGate() {
	const [authContext, ability] = await Promise.all([getAuthContext(), getAbility()]);
	const currentEmployee = authContext?.employee;
	if (!currentEmployee) {
		// The route owns its heading, so the missing-employee state keeps the page frame and h1.
		const t = await getTranslate();
		return (
			<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
				<PageHeader title={t("approvals:approvals.inbox", "Approval Inbox")} />
				<NoEmployeeError feature={t("approvals:approvals.featureName", "approve requests")} />
			</div>
		);
	}
	if (!ability || !canAccessApprovalInbox(ability, currentEmployee)) {
		return redirectWithLocale("/");
	}

	return <ApprovalInboxView />;
}
