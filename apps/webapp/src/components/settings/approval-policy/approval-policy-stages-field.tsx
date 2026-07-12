"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
	ApprovalPolicyApproverType,
	ApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";

const approverTypeOptions = [
	{ value: "direct_manager" },
	{ value: "manager_manager" },
	{ value: "org_admin" },
	{ value: "specific_employee" },
] as const;

type Translate = ReturnType<typeof useTranslate>["t"];

interface ApprovalPolicyStagesFieldProps {
	stages: ApprovalPolicyFormValues["stages"];
	onChange: (stages: ApprovalPolicyFormValues["stages"]) => void;
	onAddStage: () => void;
	t: Translate;
}

export function ApprovalPolicyStagesField({
	stages,
	onChange,
	onAddStage,
	t,
}: ApprovalPolicyStagesFieldProps) {
	function approverTypeLabel(value: (typeof approverTypeOptions)[number]["value"]) {
		switch (value) {
			case "direct_manager":
				return t("settings.approvalPolicies.approverType.directManager", "Direct manager");
			case "manager_manager":
				return t("settings.approvalPolicies.approverType.managerManager", "Manager's manager");
			case "org_admin":
				return t("settings.approvalPolicies.approverType.organizationAdmin", "Organization admin");
			case "specific_employee":
				return t("settings.approvalPolicies.approverType.specificEmployee", "Specific employee");
		}
	}

	return (
		<section className="space-y-3" aria-labelledby="approval-stages-heading">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 id="approval-stages-heading" className="text-sm font-medium">
						{t("settings.approvalPolicies.stages", "Approval stages")}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.approvalPolicies.stagesDescription",
							"Stages run in order; each request advances only after the current approver accepts it.",
						)}
					</p>
				</div>
				<Button type="button" variant="outline" size="sm" onClick={onAddStage}>
					<IconPlus className="mr-2 size-4" aria-hidden="true" />
					{t("settings.approvalPolicies.addStage", "Add stage")}
				</Button>
			</div>
			{stages.length === 0 ? (
				<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
					{t("settings.approvalPolicies.noStages", "No approval stages configured yet.")}
				</div>
			) : (
				<div className="space-y-3">
					{stages.map((stage, index) => (
						<div key={stage.localId} className="rounded-lg border p-4">
							<div className="mb-3 flex items-center justify-between gap-3">
								<h4 className="text-sm font-medium">
									{t("settings.approvalPolicies.stageNumber", "Stage {number}", {
										number: index + 1,
									})}
								</h4>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => onChange(stages.filter((item) => item.localId !== stage.localId))}
									aria-label={t("settings.approvalPolicies.removeStage", "Remove stage")}
								>
									<IconTrash className="size-4" aria-hidden="true" />
								</Button>
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="grid gap-2">
									<Label htmlFor={`approval-stage-label-${stage.localId}`}>
										{t("common.label", "Label")}
									</Label>
									<Input
										id={`approval-stage-label-${stage.localId}`}
										name={`approval-stage-label-${index + 1}`}
										autoComplete="off"
										value={stage.label}
										onChange={(event) =>
											onChange(
												stages.map((item) =>
													item.localId === stage.localId
														? { ...item, label: event.target.value }
														: item,
												),
											)
										}
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor={`approval-stage-approver-${stage.localId}`}>
										{t("settings.approvalPolicies.approver", "Approver")}
									</Label>
									<select
										id={`approval-stage-approver-${stage.localId}`}
										aria-label={t("settings.approvalPolicies.approver", "Approver")}
										name={`approval-stage-approver-${index + 1}`}
										className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
										value={stage.approverType}
										onChange={(event) =>
											onChange(
												stages.map((item) =>
													item.localId === stage.localId
														? {
																...item,
																approverType: event.target.value as ApprovalPolicyApproverType,
																approverEmployeeId:
																	event.target.value === "specific_employee"
																		? item.approverEmployeeId
																		: "",
															}
														: item,
												),
											)
										}
									>
										{approverTypeOptions.map((option) => (
											<option key={option.value} value={option.value}>
												{approverTypeLabel(option.value)}
											</option>
										))}
									</select>
								</div>
								{stage.approverType === "specific_employee" ? (
									<div className="grid gap-2 sm:col-span-2">
										<Label htmlFor={`approval-stage-employee-${stage.localId}`}>
											{t("settings.approvalPolicies.approverEmployeeId", "Approver Employee ID")}
										</Label>
										<Input
											id={`approval-stage-employee-${stage.localId}`}
											name={`approval-stage-employee-${index + 1}`}
											autoComplete="off"
											value={stage.approverEmployeeId}
											onChange={(event) =>
												onChange(
													stages.map((item) =>
														item.localId === stage.localId
															? { ...item, approverEmployeeId: event.target.value }
															: item,
													),
												)
											}
											placeholder={t(
												"settings.approvalPolicies.approverEmployeeIdPlaceholder",
												"Example: employee_123…",
											)}
										/>
									</div>
								) : null}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
