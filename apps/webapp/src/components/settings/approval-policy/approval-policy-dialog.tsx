"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import {
	type ApprovalPolicyFormValues,
	approvalTypeOptions,
	buildApprovalPolicyPayload,
	defaultApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";
import { ApprovalPolicyStagesField } from "./approval-policy-stages-field";

interface ApprovalPolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (payload: ReturnType<typeof buildApprovalPolicyPayload>) => Promise<void>;
}

function newStage(label: string): ApprovalPolicyFormValues["stages"][number] {
	return {
		localId: crypto.randomUUID(),
		label,
		approverType: "direct_manager",
		approverEmployeeId: "",
	};
}

export function ApprovalPolicyDialog({ open, onOpenChange, onSubmit }: ApprovalPolicyDialogProps) {
	const { t } = useTranslate();
	function approvalTypeLabel(value: (typeof approvalTypeOptions)[number]["value"]) {
		switch (value) {
			case "absence_entry":
				return t("settings.approvalPolicies.approvalType.absenceRequests", "Absence requests");
			case "time_entry":
				return t("settings.approvalPolicies.approvalType.timeEntryChanges", "Time entry changes");
			case "travel_expense_claim":
				return t("settings.approvalPolicies.approvalType.travelExpenses", "Travel expenses");
		}
	}
	const form = useForm({
		defaultValues: defaultApprovalPolicyFormValues,
		onSubmit: async ({ value }) => {
			try {
				await onSubmit(
					buildApprovalPolicyPayload(value, {
						activePolicyRequiresStage: t(
							"settings.approvalPolicies.validation.activePolicyRequiresStage",
							"Active policies require at least one approval stage.",
						),
						specificEmployeeRequiresId: t(
							"settings.approvalPolicies.validation.specificEmployeeRequiresId",
							"Specific employee stages require an approver employee ID.",
						),
					}),
				);
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

	useEffect(() => {
		if (open) {
			form.reset(defaultApprovalPolicyFormValues);
		}
	}, [open, form]);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.approvalPolicies.createPolicy", "Create Approval Policy")}
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
						<form.Field name="name">
							{(field) => (
								<TFormItem>
									<TFormLabel required>{t("common.name", "Name")}</TFormLabel>
									<TFormControl>
										<Input
											name="name"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
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
									<TFormLabel>{t("common.description", "Description")}</TFormLabel>
									<TFormControl>
										<Textarea
											name="description"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
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
												onChange={(event) => field.handleChange(event.target.value)}
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
											<Label htmlFor="approval-policy-active" className="text-base">
												{t("settings.approvalPolicies.activeLabel", "Active policy")}
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
										{t("settings.approvalPolicies.approvalTypes", "Approval types")}
									</legend>
									<div className="grid gap-2 sm:grid-cols-3">
										{approvalTypeOptions.map((option) => (
											<label key={option.value} className="flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													aria-label={approvalTypeLabel(option.value)}
													checked={field.state.value.includes(option.value)}
													onChange={(event) =>
														field.handleChange(
															event.target.checked
																? [...field.state.value, option.value]
																: field.state.value.filter((value) => value !== option.value),
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
											newStage(t("settings.approvalPolicies.defaultStageLabel", "Manager review")),
										])
									}
									t={t}
								/>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={form.state.isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={form.state.isSubmitting}>
							{form.state.isSubmitting && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{t("common.create", "Create")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
