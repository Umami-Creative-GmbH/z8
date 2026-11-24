"use client";

import { useTranslate } from "@tolgee/react";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { ContractsBulkCsvTab } from "./contracts-bulk-csv-tab";
import { ContractsContractorsTab } from "./contracts-contractors-tab";
import { ContractsDefaultsTab } from "./contracts-defaults-tab";
import { ContractsReviewsTab } from "./contracts-reviews-tab";
import { ContractsStatutoryTab } from "./contracts-statutory-tab";
import { ContractsTemplatesTab } from "./contracts-templates-tab";
import { ContractsWorkPoliciesTab } from "./contracts-work-policies-tab";

export type ContractsHubTab =
	| "defaults"
	| "templates"
	| "work-policies"
	| "contractors"
	| "bulk"
	| "reviews"
	| "statutory";

export interface ContractsHubClientProps {
	organizationId: string;
	organizationTimezone: string;
	workPolicyVersioningEnabled: boolean;
}

export function ContractsHubClient({
	organizationId,
	organizationTimezone,
	workPolicyVersioningEnabled,
}: ContractsHubClientProps) {
	const { t } = useTranslate();

	return (
		<SettingsTabbedPage<ContractsHubTab>
			title={t("settings.contracts.title", "Contracts")}
			defaultTab="defaults"
			tabs={[
				{
					value: "defaults",
					label: t("settings.contracts.tabs.defaults", "Defaults"),
					description: t(
						"settings.contracts.tabs.defaultsDescription",
						"Configure date-effective organization and primary-team default contracts with affected-employee previews.",
					),
					panel: (
						<ContractsDefaultsTab
							organizationId={organizationId}
							organizationTimezone={organizationTimezone}
						/>
					),
				},
				{
					value: "templates",
					label: t("settings.contracts.tabs.templates", "Templates"),
					description: t(
						"settings.contracts.tabs.templatesDescription",
						"Create and version immutable stamping contract templates and apply them with divergence protection.",
					),
					panel: (
						<ContractsTemplatesTab
							organizationId={organizationId}
							organizationTimezone={organizationTimezone}
						/>
					),
				},
				{
					value: "work-policies",
					label: t("settings.contracts.tabs.workPolicies", "Work Policies"),
					description: t(
						"settings.contracts.tabs.workPoliciesDescription",
						"Publish effective-dated work policy versions, toggle schedule/regulation/presence rules, and manage assignments.",
					),
					panel: (
						<ContractsWorkPoliciesTab
							organizationId={organizationId}
							organizationTimezone={organizationTimezone}
							workPolicyVersioningEnabled={workPolicyVersioningEnabled}
						/>
					),
				},
				{
					value: "contractors",
					label: t("settings.contracts.tabs.contractors", "External Contractors"),
					description: t(
						"settings.contracts.tabs.contractorsDescription",
						"Set External Contractors' effective-dated hourly or daily rates and their company, VAT ID and PO reference.",
					),
					panel: <ContractsContractorsTab />,
				},
				{
					value: "bulk",
					label: t("settings.contracts.tabs.bulk", "Bulk & CSV"),
					description: t(
						"settings.contracts.tabs.bulkDescription",
						"Run dry-run bulk contract updates, validate contract or leaving-date CSV imports, and monitor batch progress.",
					),
					panel: (
						<ContractsBulkCsvTab
							organizationId={organizationId}
							organizationTimezone={organizationTimezone}
						/>
					),
				},
				{
					value: "reviews",
					label: t("settings.contracts.tabs.reviews", "Reviews & Conflicts"),
					description: t(
						"settings.contracts.tabs.reviewsDescription",
						"Statutory findings and acknowledgements, contract migration conflicts, departure and payroll reviews, and migrated legacy terms in one place. Acknowledgements that newer work or shifts invalidated are highlighted.",
					),
					panel: (
						<ContractsReviewsTab
							organizationId={organizationId}
							organizationTimezone={organizationTimezone}
						/>
					),
				},
				{
					value: "statutory",
					label: t("settings.contracts.tabs.statutory", "Statutory limits"),
					description: t(
						"settings.contracts.tabs.statutoryDescription",
						"Review German statutory baselines and set when planners and HR are warned before a limit is reached.",
					),
					panel: <ContractsStatutoryTab organizationId={organizationId} />,
				},
			]}
		/>
	);
}
