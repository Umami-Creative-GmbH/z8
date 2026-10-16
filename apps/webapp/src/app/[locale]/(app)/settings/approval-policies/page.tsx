import { type ReactNode, Suspense } from "react";
import { ApprovalEscalationManagement } from "@/components/settings/approval-escalation/approval-escalation-management";
import { DeputyDecisionsSetting } from "@/components/settings/approval-escalation/deputy-decisions-setting";
import { ApprovalPolicyManagement } from "@/components/settings/approval-policy/approval-policy-management";
import {
	type ApprovalSettingsTab,
	ApprovalSettingsTabs,
} from "@/components/settings/approval-settings/approval-settings-tabs";
import { EmployeeGroupManagement } from "@/components/settings/employee-group-management";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { loadApprovalSettings } from "@/lib/approvals/approval-settings";
import { getAbility, getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function ApprovalPoliciesSettingsContent() {
	const [context, ability] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getAbility(),
	]);
	const organizationId = context?.authContext.session.activeOrganizationId;
	const canConfigurePolicies = context?.accessTier === "orgAdmin";
	const canManageEscalation = ability?.can("manage", "Approval") ?? false;
	if (!organizationId || (!canConfigurePolicies && !canManageEscalation)) {
		return redirectWithLocale("/settings");
	}

	const panels: Partial<Record<ApprovalSettingsTab, ReactNode>> = {};
	if (canConfigurePolicies) {
		panels.policies = (
			<ApprovalPolicyManagement organizationId={organizationId} />
		);
		panels.groups = <EmployeeGroupManagement organizationId={organizationId} />;
	}
	if (canManageEscalation) {
		const settings = await loadApprovalSettings(db, organizationId);
		panels.escalation = (
			<div className="space-y-4">
				<ApprovalEscalationManagement
					organizationId={organizationId}
					section="escalation"
				/>
				<DeputyDecisionsSetting enabled={settings.deputyDecisionsEnabled} />
			</div>
		);
		panels.attention = (
			<ApprovalEscalationManagement
				organizationId={organizationId}
				section="attention"
			/>
		);
		panels.channels = (
			<ApprovalEscalationManagement
				organizationId={organizationId}
				section="channels"
			/>
		);
		panels.history = (
			<ApprovalEscalationManagement
				organizationId={organizationId}
				section="history"
			/>
		);
	}
	return <ApprovalSettingsTabs key={organizationId} panels={panels} />;
}

function ApprovalPoliciesSettingsLoading() {
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

export default function ApprovalPoliciesSettingsPage() {
	return (
		<Suspense fallback={<ApprovalPoliciesSettingsLoading />}>
			<ApprovalPoliciesSettingsContent />
		</Suspense>
	);
}
