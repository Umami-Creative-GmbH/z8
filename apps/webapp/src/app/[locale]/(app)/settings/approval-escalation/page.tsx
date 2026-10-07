import { Suspense } from "react";
import { ApprovalEscalationManagement } from "@/components/settings/approval-escalation/approval-escalation-management";
import { Skeleton } from "@/components/ui/skeleton";
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

	return <ApprovalEscalationManagement organizationId={organizationId} />;
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
