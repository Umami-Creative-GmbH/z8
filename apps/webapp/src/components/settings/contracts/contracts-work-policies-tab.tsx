"use client";

import { IconHistory, IconInfoCircle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { WorkPolicyManagement } from "@/components/settings/work-policy/work-policy-management";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export interface ContractsWorkPoliciesTabProps {
	organizationId: string;
	organizationTimezone: string;
	workPolicyVersioningEnabled: boolean;
}

export function ContractsWorkPoliciesTab({
	organizationId,
	organizationTimezone,
	workPolicyVersioningEnabled,
}: ContractsWorkPoliciesTabProps) {
	const { t } = useTranslate();

	return (
		<div className="space-y-4">
			<Alert role="status">
				{workPolicyVersioningEnabled ? (
					<IconHistory className="size-4" aria-hidden="true" />
				) : (
					<IconInfoCircle className="size-4" aria-hidden="true" />
				)}
				<AlertTitle className="flex flex-wrap items-center gap-2">
					<span>
						{workPolicyVersioningEnabled
							? t(
									"settings.contracts.workPolicies.versioningActiveTitle",
									"Effective-dated policy versioning active",
								)
							: t(
									"settings.contracts.workPolicies.versioningPendingTitle",
									"Current-day and metadata policy editing",
								)}
					</span>
					<Badge variant={workPolicyVersioningEnabled ? "default" : "secondary"}>
						{workPolicyVersioningEnabled
							? t("settings.contracts.workPolicies.versioningOn", "Future scheduling enabled")
							: t("settings.contracts.workPolicies.versioningOff", "Immediate edits")}
					</Badge>
				</AlertTitle>
				<AlertDescription>
					{workPolicyVersioningEnabled
						? t(
								"settings.contracts.workPolicies.versioningActiveDescription",
								"Rule changes publish immutable effective-dated versions so historical absences, work balances, and compliance records never drift. Metadata-only edits (name and description) update in place.",
							)
						: t(
								"settings.contracts.workPolicies.versioningPendingDescription",
								"Metadata and current-day policy edits save seamlessly while preserving all ArbZG regulation rules and disabled section drafts. Future-dated scheduling activates once policy versioning rollout completes.",
							)}
				</AlertDescription>
			</Alert>

			<WorkPolicyManagement
				organizationId={organizationId}
				settingsAccess="orgAdmin"
				organizationTimezone={organizationTimezone}
				workPolicyVersioningEnabled={workPolicyVersioningEnabled}
			/>
		</div>
	);
}
