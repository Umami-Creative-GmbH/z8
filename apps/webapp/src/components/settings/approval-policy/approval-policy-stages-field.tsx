"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import { EmployeeSingleSelect } from "@/components/employee-select/employee-select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
	ApprovalPolicyApproverType,
	ApprovalPolicyFallbackBehavior,
	ApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";
import { fallbackBehaviorOptions } from "./approval-policy-dialog-utils";
import {
	type ApprovalPolicyTranslate,
	approverTypeLabel,
	fallbackBehaviorLabel,
	unknownEmployeeLabel,
} from "./approval-policy-labels";
import type { ApproverEmployeeLookup } from "./use-approver-employees";

const approverTypeOptions = [
	{ value: "direct_manager" },
	{ value: "manager_manager" },
	{ value: "org_admin" },
	{ value: "specific_employee" },
] as const;

interface ApprovalPolicyStagesFieldProps {
	stages: ApprovalPolicyFormValues["stages"];
	onChange: (stages: ApprovalPolicyFormValues["stages"]) => void;
	onAddStage: () => void;
	/** Names stored specific-employee approvers; unresolved IDs show as unknown. */
	approverLookup?: ApproverEmployeeLookup;
	t: ApprovalPolicyTranslate;
}

export function ApprovalPolicyStagesField({
	stages,
	onChange,
	onAddStage,
	approverLookup,
	t,
}: ApprovalPolicyStagesFieldProps) {
	function fallbackBehaviorDescription(value: ApprovalPolicyFallbackBehavior) {
		switch (value) {
			case "fail":
				return t(
					"settings.approvalPolicies.fallbackBehavior.fail.description",
					"Reject the request when this stage cannot resolve an approver.",
				);
			case "default_manager":
				return t(
					"settings.approvalPolicies.fallbackBehavior.defaultManager.description",
					"Send the request to the default manager when this stage cannot resolve an approver.",
				);
			case "organization_admin":
				return t(
					"settings.approvalPolicies.fallbackBehavior.organizationAdmin.description",
					"Send the request to an organization admin when this stage cannot resolve an approver.",
				);
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
					{t(
						"settings.approvalPolicies.noStages",
						"No approval stages configured yet.",
					)}
				</div>
			) : (
				<div className="space-y-3">
					{stages.map((stage, index) => (
						<div key={stage.localId} className="rounded-lg border p-4">
							<div className="mb-3 flex items-center justify-between gap-3">
								<h4 className="text-sm font-medium">
									{t(
										"settings.approvalPolicies.stageNumber",
										"Stage {number}",
										{
											number: index + 1,
										},
									)}
								</h4>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() =>
										onChange(
											stages.filter((item) => item.localId !== stage.localId),
										)
									}
									aria-label={t(
										"settings.approvalPolicies.removeStageNumber",
										"Remove stage {number}",
										{ number: index + 1 },
									)}
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
										aria-label={t(
											"settings.approvalPolicies.approver",
											"Approver",
										)}
										name={`approval-stage-approver-${index + 1}`}
										className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
										value={stage.approverType}
										onChange={(event) =>
											onChange(
												stages.map((item) =>
													item.localId === stage.localId
														? {
																...item,
																approverType: event.target
																	.value as ApprovalPolicyApproverType,
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
												{approverTypeLabel(option.value, t)}
											</option>
										))}
									</select>
								</div>
								<div className="grid gap-2 sm:col-span-2">
									<Label htmlFor={`approval-stage-fallback-${stage.localId}`}>
										{t(
											"settings.approvalPolicies.fallbackBehavior.label",
											"Fallback behavior",
										)}
									</Label>
									<select
										id={`approval-stage-fallback-${stage.localId}`}
										aria-label={t(
											"settings.approvalPolicies.fallbackBehavior.label",
											"Fallback behavior",
										)}
										aria-describedby={`approval-stage-fallback-description-${stage.localId}`}
										name={`approval-stage-fallback-${index + 1}`}
										className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
										value={stage.fallbackBehavior}
										onChange={(event) =>
											onChange(
												stages.map((item) =>
													item.localId === stage.localId
														? {
																...item,
																fallbackBehavior: event.target
																	.value as ApprovalPolicyFallbackBehavior,
															}
														: item,
												),
											)
										}
									>
										{fallbackBehaviorOptions.map((option) => (
											<option key={option.value} value={option.value}>
												{fallbackBehaviorLabel(option.value, t)}
											</option>
										))}
									</select>
									<p
										id={`approval-stage-fallback-description-${stage.localId}`}
										className="text-sm text-muted-foreground"
									>
										{fallbackBehaviorDescription(stage.fallbackBehavior)}
									</p>
								</div>
								{stage.approverType === "specific_employee" ? (
									<EmployeeSingleSelect
										className="sm:col-span-2"
										label={t(
											"settings.approvalPolicies.approverEmployee",
											"Approving employee",
										)}
										value={stage.approverEmployeeId || null}
										onChange={(employeeId) =>
											onChange(
												stages.map((item) =>
													item.localId === stage.localId
														? {
																...item,
																approverEmployeeId: employeeId ?? "",
															}
														: item,
												),
											)
										}
										placeholder={
											stage.approverEmployeeId &&
											approverLookup?.(stage.approverEmployeeId).status ===
												"unknown"
												? unknownEmployeeLabel(stage.approverEmployeeId, t)
												: t(
														"settings.approvalPolicies.selectApproverEmployee",
														"Select employee",
													)
										}
									/>
								) : null}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
