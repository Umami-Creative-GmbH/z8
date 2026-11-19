"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import {
	type ApprovalPolicyEditState,
	type ApprovalPolicyFormValues,
	approvalTypeOptions,
	buildApprovalPolicyPayload,
	defaultApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";
import { ApprovalPolicyChainPreview } from "./approval-policy-preview";
import { ApprovalPolicyStagesField } from "./approval-policy-stages-field";
import { useApproverEmployees } from "./use-approver-employees";

export type ApprovalPolicySubmitPayload = ReturnType<
	typeof buildApprovalPolicyPayload
> & { id?: string };

interface ApprovalPolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The stored policy being edited; omitted or null creates a new policy. */
	policy?: ApprovalPolicyEditState | null;
	onSubmit: (payload: ApprovalPolicySubmitPayload) => Promise<void>;
}

function newStage(label: string): ApprovalPolicyFormValues["stages"][number] {
	return {
		localId: crypto.randomUUID(),
		label,
		approverType: "direct_manager",
		approverEmployeeId: "",
		fallbackBehavior: "fail",
	};
}

export function ApprovalPolicyDialog({
	open,
	onOpenChange,
	policy = null,
	onSubmit,
}: ApprovalPolicyDialogProps) {
	const { t } = useTranslate();
	const isEditing = policy !== null;
	function approvalTypeLabel(
		value: (typeof approvalTypeOptions)[number]["value"],
	) {
		switch (value) {
			case "absence":
				return t("settings.approvalPolicies.approvalType.absence", "Absence");
			case "time_correction":
				return t(
					"settings.approvalPolicies.approvalType.timeCorrection",
					"Time correction",
				);
			case "manual_time_submission":
				return t(
					"settings.approvalPolicies.approvalType.manualTimeSubmission",
					"Manual time submission",
				);
			case "policy_clock_out":
				return t(
					"settings.approvalPolicies.approvalType.policyClockOut",
					"Policy clock-out",
				);
			case "travel_expense":
				return t(
					"settings.approvalPolicies.approvalType.travelExpense",
					"Travel expense",
				);
			case "shift_request":
				return t(
					"settings.approvalPolicies.approvalType.shiftRequest",
					"Shift request",
				);
			case "compliance_exception":
				return t(
					"settings.approvalPolicies.approvalType.complianceException",
					"Compliance exception",
				);
			case "period_submission":
				return t(
					"settings.approvalPolicies.approvalType.periodSubmission",
					"Period submission",
				);
		}
	}
	const form = useForm({
		defaultValues: policy?.values ?? defaultApprovalPolicyFormValues,
		onSubmit: async ({ value }) => {
			try {
				const payload = buildApprovalPolicyPayload(
					value,
					{
						activePolicyRequiresStage: t(
							"settings.approvalPolicies.validation.activePolicyRequiresStage",
							"Active policies require at least one approval stage.",
						),
						specificEmployeeRequiresId: t(
							"settings.approvalPolicies.validation.specificEmployeeRequired",
							"Choose the approving employee for each specific employee stage.",
						),
					},
					{
						preservedConditions: policy?.preservedConditions,
						legacyApprovalTypes: policy?.legacyApprovalTypes,
					},
				);
				await onSubmit(policy ? { ...payload, id: policy.id } : payload);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.approvalPolicies.toast.saveFailed",
								"Approval policy could not be saved.",
							),
				);
			}
		},
	});

	// `form.state` is not reactive; subscribe so the footer reflects submission.
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const stages = useStore(form.store, (state) => state.values.stages);
	const approverLookup = useApproverEmployees(
		stages.flatMap((stage) =>
			stage.approverType === "specific_employee" && stage.approverEmployeeId
				? [stage.approverEmployeeId]
				: [],
		),
	);
	const preservedConditionCount = policy?.preservedConditions.length ?? 0;
	const legacyApprovalTypeCount = policy?.legacyApprovalTypes.length ?? 0;

	useEffect(() => {
		if (open) {
			form.reset(policy?.values ?? defaultApprovalPolicyFormValues);
		}
	}, [open, form, policy]);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t(
									"settings.approvalPolicies.editPolicyTitle",
									"Edit approval policy",
								)
							: t(
									"settings.approvalPolicies.createPolicy",
									"Create Approval Policy",
								)}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.approvalPolicies.dialogDescription",
							"Define when an approval chain applies and which approvers handle each sequential stage.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-5">
						{preservedConditionCount > 0 ? (
							<p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
								{t(
									"settings.approvalPolicies.preservedConditions",
									"This policy has {count, plural, one {# further condition} other {# further conditions}} that can't be changed here. Saving keeps {count, plural, one {it} other {them}} unchanged.",
									{ count: preservedConditionCount },
								)}
							</p>
						) : null}
						{legacyApprovalTypeCount > 0 ? (
							<p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
								{t(
									"settings.approvalPolicies.legacyApprovalTypesNotice",
									"This policy also matches {count, plural, one {# older approval type} other {# older approval types}} that can't be selected here. Saving keeps {count, plural, one {it} other {them}} unchanged.",
									{ count: legacyApprovalTypeCount },
								)}
							</p>
						) : null}
						<form.Field name="name">
							{(field) => (
								<TFormItem>
									<TFormLabel required>{t("common.name", "Name")}</TFormLabel>
									<TFormControl>
										<Input
											name="name"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.approvalPolicies.namePlaceholder",
												"Example: Absence escalation…",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="description">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("common.description", "Description")}
									</TFormLabel>
									<TFormControl>
										<Textarea
											name="description"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.approvalPolicies.descriptionPlaceholder",
												"Example: Escalates sensitive workflows to operations…",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field name="priority">
								{(field) => (
									<TFormItem>
										<TFormLabel required>
											{t("settings.approvalPolicies.priority", "Priority")}
										</TFormLabel>
										<TFormControl>
											<Input
												name="priority"
												autoComplete="off"
												type="number"
												min="1"
												step="1"
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="isActive">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label
												htmlFor="approval-policy-active"
												className="text-base"
											>
												{t(
													"settings.approvalPolicies.activeLabel",
													"Active policy",
												)}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.approvalPolicies.activeDescription",
													"Eligible requests can match this policy.",
												)}
											</p>
										</div>
										<Switch
											id="approval-policy-active"
											checked={field.state.value}
											onCheckedChange={field.handleChange}
										/>
									</div>
								)}
							</form.Field>
						</div>

						<form.Field name="approvalTypes">
							{(field) => (
								<fieldset className="space-y-3 rounded-lg border p-4">
									<legend className="text-sm font-medium">
										{t(
											"settings.approvalPolicies.approvalTypes",
											"Approval types",
										)}
									</legend>
									<div className="grid gap-2 sm:grid-cols-3">
										{approvalTypeOptions.map((option) => (
											<label
												key={option.value}
												className="flex items-center gap-2 text-sm"
											>
												<input
													type="checkbox"
													aria-label={approvalTypeLabel(option.value)}
													checked={field.state.value.includes(option.value)}
													onChange={(event) =>
														field.handleChange(
															event.target.checked
																? [...field.state.value, option.value]
																: field.state.value.filter(
																		(value) => value !== option.value,
																	),
														)
													}
												/>
												{approvalTypeLabel(option.value)}
											</label>
										))}
									</div>
								</fieldset>
							)}
						</form.Field>

						<form.Field name="stages">
							{(field) => (
								<ApprovalPolicyStagesField
									stages={field.state.value}
									onChange={field.handleChange}
									onAddStage={() =>
										field.handleChange([
											...field.state.value,
											newStage(
												t(
													"settings.approvalPolicies.defaultStageLabel",
													"Manager review",
												),
											),
										])
									}
									approverLookup={approverLookup}
									t={t}
								/>
							)}
						</form.Field>

						<ApprovalPolicyChainPreview
							stages={stages}
							approverLookup={approverLookup}
						/>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && (
								<IconLoader2
									className="mr-2 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							)}
							{isEditing
								? t("settings.approvalPolicies.savePolicySubmit", "Save policy")
								: t("settings.approvalPolicies.createPolicySubmit", "Create policy")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
