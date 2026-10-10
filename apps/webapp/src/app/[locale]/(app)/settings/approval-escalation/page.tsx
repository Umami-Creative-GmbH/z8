import { Suspense } from "react";
import { ApprovalEscalationManagement } from "@/components/settings/approval-escalation/approval-escalation-management";
import { DeputyDecisionsSetting } from "@/components/settings/approval-escalation/deputy-decisions-setting";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { loadApprovalSettings } from "@/lib/approvals/approval-settings";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function ApprovalEscalationSettingsContent() {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const ability = await getAbility();

	if (!ability || ability.cannot("manage", "Approval")) {
		return redirectWithLocale("/settings");
	}

	const approvalSettings = await loadApprovalSettings(db, organizationId);

	return (
		<ApprovalEscalationManagement
			organizationId={organizationId}
			approvalSettings={
				<DeputyDecisionsSetting enabled={approvalSettings.deputyDecisionsEnabled} />
			}
		/>
	);
}

function ApprovalEscalationSettingsLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-5 w-96" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function ApprovalEscalationSettingsPage() {
	return (
		<Suspense fallback={<ApprovalEscalationSettingsLoading />}>
			<ApprovalEscalationSettingsContent />
		</Suspense>
	);
}
