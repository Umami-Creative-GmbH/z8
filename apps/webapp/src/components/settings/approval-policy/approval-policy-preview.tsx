"use client";

import { IconArrowDown } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ApprovalPolicyFormValues } from "./approval-policy-dialog-utils";
import {
	approverTypeLabel,
	fallbackBehaviorLabel,
	unknownEmployeeLabel,
} from "./approval-policy-labels";
import type { ApproverEmployeeLookup } from "./use-approver-employees";

interface ApprovalPolicyChainPreviewProps {
	stages: ApprovalPolicyFormValues["stages"];
	approverLookup: ApproverEmployeeLookup;
}

/**
 * The approval chain of the policy being edited, stage by stage, as a request
 * matching it would move through it. Approvers are named by role; a specific
 * employee by name once it resolves.
 */
export function ApprovalPolicyChainPreview({
	stages,
	approverLookup,
}: ApprovalPolicyChainPreviewProps) {
	const { t } = useTranslate();

	function approverDescription(stage: ApprovalPolicyFormValues["stages"][number]) {
		if (stage.approverType !== "specific_employee") {
			return approverTypeLabel(stage.approverType, t);
		}
		const employeeId = stage.approverEmployeeId.trim();
		if (!employeeId) {
			return t(
				"settings.approvalPolicies.preview.noEmployeeSelected",
				"No employee selected yet",
			);
		}
		const resolution = approverLookup(employeeId);
		if (resolution.status === "resolved") return resolution.name;
		if (resolution.status === "unknown") return unknownEmployeeLabel(employeeId, t);
		return t("settings.approvalPolicies.preview.loadingEmployee", "Loading employee…");
	}

	return (
		<section
			className="space-y-3 rounded-lg border bg-muted/30 p-4"
			aria-labelledby="approval-chain-preview-heading"
		>
			<div className="space-y-1">
				<h3 id="approval-chain-preview-heading" className="text-sm font-medium">
					{t("settings.approvalPolicies.preview.chainTitle", "Approval chain preview")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.approvalPolicies.preview.chainDescription",
						"How a matching request moves through the stages as configured above.",
					)}
				</p>
			</div>
			{stages.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.approvalPolicies.preview.noStages",
						"Add a stage to see the approval chain.",
					)}
				</p>
			) : (
				<ol
					className="space-y-1"
					aria-label={t(
						"settings.approvalPolicies.preview.ariaLabel",
						"Approval chain preview",
					)}
				>
					<li className="text-sm text-muted-foreground">
						{t("settings.approvalPolicies.preview.stage.requester", "Requester")}
					</li>
					{stages.map((stage, index) => (
						<li key={stage.localId} className="space-y-1">
							<IconArrowDown
								className="ml-1 size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							<div className="min-w-0 rounded-md border bg-background px-3 py-2">
								<p className="break-words text-sm font-medium">
									<span className="tabular-nums">
										{t("settings.approvalPolicies.stageNumber", "Stage {number}", {
											number: index + 1,
										})}
									</span>
									{stage.label.trim() ? ` · ${stage.label.trim()}` : null}
								</p>
								<p className="break-words text-sm">{approverDescription(stage)}</p>
								<p className="text-xs text-muted-foreground">
									{t(
										"settings.approvalPolicies.preview.fallback",
										"If no approver is found: {fallback}",
										{ fallback: fallbackBehaviorLabel(stage.fallbackBehavior, t) },
									)}
								</p>
							</div>
						</li>
					))}
					<li className="space-y-1">
						<IconArrowDown
							className="ml-1 size-4 text-muted-foreground"
							aria-hidden="true"
						/>
						<p className="text-sm text-muted-foreground">
							{t("settings.approvalPolicies.preview.stage.approved", "Approved")}
						</p>
					</li>
				</ol>
			)}
		</section>
	);
}
