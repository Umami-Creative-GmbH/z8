import { Suspense } from "react";
import { ApprovalEscalationManagement } from "@/components/settings/approval-escalation/approval-escalation-management";
import { DeputyDecisionsSetting } from "@/components/settings/approval-escalation/deputy-decisions-setting";
import { ApprovalPolicyManagement } from "@/components/settings/approval-policy/approval-policy-management";
import { ApprovalTriageSettingsForm } from "@/components/settings/approval-settings/triage-settings-form";
import { EmployeeGroupManagement } from "@/components/settings/employee-group-management";
import {
	SettingsTabbedPage,
	type SettingsTabbedPageTab,
} from "@/components/settings/settings-tabbed-page";
import { db } from "@/db";
import { loadApprovalSettings } from "@/lib/approvals/approval-settings";
import { getEffectiveApprovalTriagePolicy } from "@/lib/approvals/triage-policy";
import { getRenderOrganizationAbility } from "@/lib/auth/render-context";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { getTranslate } from "@/tolgee/server";
import { ApprovalSettingsLoading } from "./approval-settings-loading";

export type ApprovalSettingsTab =
	| "policies"
	| "groups"
	| "triage"
	| "escalation"
	| "attention"
	| "channels"
	| "history";

async function ApprovalPoliciesSettingsContent() {
	const [caller, ability, t] = await Promise.all([
		getCurrentSettingsAccess(),
		getRenderOrganizationAbility(),
		getTranslate(),
	]);
	const organizationId = caller?.organizationId ?? null;
	const settingsAccess = caller?.settingsAccess ?? null;
	const canConfigurePolicies = meetsSettingsAccess(settingsAccess, "orgAdmin");
	const canManageEscalation =
		settingsAccess !== null && (ability?.can("manage", "Approval") ?? false);
	if (!organizationId || (!canConfigurePolicies && !canManageEscalation)) {
		return redirectWithLocale("/settings");
	}

	const [triagePolicy, settings] = await Promise.all([
		canConfigurePolicies
			? getEffectiveApprovalTriagePolicy({ organizationId })
			: Promise.resolve(null),
		canManageEscalation ? loadApprovalSettings(db, organizationId) : Promise.resolve(null),
	]);

	const tabs: SettingsTabbedPageTab<ApprovalSettingsTab>[] = [
		...(canConfigurePolicies && triagePolicy
			? [
					{
						value: "policies" as const,
						label: t("settings.approvalPolicies.title", "Approval Policies"),
						panel: <ApprovalPolicyManagement organizationId={organizationId} />,
					},
					{
						value: "groups" as const,
						label: t("settings.employeeGroups.title", "Employee Groups"),
						panel: <EmployeeGroupManagement organizationId={organizationId} />,
					},
					{
						value: "triage" as const,
						label: t("settings.approvalTriage.title", "Approval triage"),
						panel: (
							<ApprovalTriageSettingsForm
								key={`${organizationId}:${triagePolicy.staleAfterHours}:${triagePolicy.smallCorrectionMinutes}`}
								policy={triagePolicy}
							/>
						),
					},
				]
			: []),
		...(canManageEscalation && settings
			? [
					{
						value: "escalation" as const,
						label: t("settings.approvalEscalation.title", "Approval Escalation"),
						panel: (
							<div className="space-y-4">
								<ApprovalEscalationManagement
									organizationId={organizationId}
									section="escalation"
								/>
								<DeputyDecisionsSetting enabled={settings.deputyDecisionsEnabled} />
							</div>
						),
					},
					{
						value: "attention" as const,
						label: t("settings.approvalEscalation.attention.title", "Needs attention"),
						panel: (
							<ApprovalEscalationManagement organizationId={organizationId} section="attention" />
						),
					},
					{
						value: "channels" as const,
						label: t("settings.approvalEscalation.channels.title", "Channel delivery preferences"),
						panel: (
							<ApprovalEscalationManagement organizationId={organizationId} section="channels" />
						),
					},
					{
						value: "history" as const,
						label: t("settings.approvalEscalation.revisions.title", "Policy history"),
						panel: (
							<ApprovalEscalationManagement organizationId={organizationId} section="history" />
						),
					},
				]
			: []),
	];

	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.navigation.approval.title", "Approval")}
			description={t(
				"settings.approvalSettings.pageDescription",
				"Configure who approves requests, when overdue approvals escalate, and which approval issues need follow-up.",
			)}
			measure
			tabs={tabs}
		/>
	);
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
