import { type ReactNode, Suspense } from "react";
import { ApprovalEscalationManagement } from "@/components/settings/approval-escalation/approval-escalation-management";
import { DeputyDecisionsSetting } from "@/components/settings/approval-escalation/deputy-decisions-setting";
import { ApprovalPolicyManagement } from "@/components/settings/approval-policy/approval-policy-management";
import {
	type ApprovalSettingsTab,
	ApprovalSettingsTabs,
} from "@/components/settings/approval-settings/approval-settings-tabs";
import { ApprovalTriageSettingsForm } from "@/components/settings/approval-settings/triage-settings-form";
import { EmployeeGroupManagement } from "@/components/settings/employee-group-management";
import { db } from "@/db";
import { loadApprovalSettings } from "@/lib/approvals/approval-settings";
import { getEffectiveApprovalTriagePolicy } from "@/lib/approvals/triage-policy";
import { getRenderOrganizationAbility } from "@/lib/auth/render-context";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { ApprovalSettingsLoading } from "./approval-settings-loading";

async function ApprovalPoliciesSettingsContent() {
	const [caller, ability] = await Promise.all([
		getCurrentSettingsAccess(),
		getRenderOrganizationAbility(),
	]);
	const organizationId = caller?.organizationId ?? null;
	const settingsAccess = caller?.settingsAccess ?? null;
	const canConfigurePolicies = meetsSettingsAccess(settingsAccess, "orgAdmin");
	const canManageEscalation =
		settingsAccess !== null && (ability?.can("manage", "Approval") ?? false);
	if (!organizationId || (!canConfigurePolicies && !canManageEscalation)) {
		return redirectWithLocale("/settings");
	}

	const panels: Partial<Record<ApprovalSettingsTab, ReactNode>> = {};
	if (canConfigurePolicies) {
		panels.policies = <ApprovalPolicyManagement organizationId={organizationId} />;
		panels.groups = <EmployeeGroupManagement organizationId={organizationId} />;
		const triagePolicy = await getEffectiveApprovalTriagePolicy({
			organizationId,
		});
		panels.triage = (
			<ApprovalTriageSettingsForm
				key={`${organizationId}:${triagePolicy.staleAfterHours}:${triagePolicy.smallCorrectionMinutes}`}
				policy={triagePolicy}
			/>
		);
	}
	if (canManageEscalation) {
		const settings = await loadApprovalSettings(db, organizationId);
		panels.escalation = (
			<div className="space-y-4">
				<ApprovalEscalationManagement organizationId={organizationId} section="escalation" />
				<DeputyDecisionsSetting enabled={settings.deputyDecisionsEnabled} />
			</div>
		);
		panels.attention = (
			<ApprovalEscalationManagement organizationId={organizationId} section="attention" />
		);
		panels.channels = (
			<ApprovalEscalationManagement organizationId={organizationId} section="channels" />
		);
		panels.history = (
			<ApprovalEscalationManagement organizationId={organizationId} section="history" />
		);
	}
	return <ApprovalSettingsTabs key={organizationId} panels={panels} />;
}

function ApprovalPoliciesSettingsLoading() {
	return <ApprovalSettingsLoading />;
}

export default function ApprovalPoliciesSettingsPage() {
	return (
		<Suspense fallback={<ApprovalPoliciesSettingsLoading />}>
			<ApprovalPoliciesSettingsContent />
		</Suspense>
	);
}
