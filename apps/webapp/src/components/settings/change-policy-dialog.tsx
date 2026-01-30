"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createChangePolicy,
	updateChangePolicy,
	type ChangePolicyRecord,
	type CreateChangePolicyInput,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";

interface ChangePolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingPolicy: ChangePolicyRecord | null;
	onSuccess: () => void;
}

const defaultValues: CreateChangePolicyInput = {
	name: "",
	description: "",
	selfServiceDays: 0,
	approvalDays: 7,
	noApprovalRequired: false,
	notifyAllManagers: false,
};

export function ChangePolicyDialog({
	open,
	onOpenChange,
	organizationId,
	editingPolicy,
	onSuccess,
}: ChangePolicyDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingPolicy;

	const form = useForm({
		defaultValues: editingPolicy
			? {
					name: editingPolicy.name,
					description: editingPolicy.description ?? "",
					selfServiceDays: editingPolicy.selfServiceDays,
					approvalDays: editingPolicy.approvalDays,
					noApprovalRequired: editingPolicy.noApprovalRequired,
					notifyAllManagers: editingPolicy.notifyAllManagers,
				}
			: defaultValues,
		onSubmit: async ({ value }) => {
			if (isEditing) {
				updateMutation.mutate({ id: editingPolicy.id, data: value });
			} else {
				createMutation.mutate(value);
			}
		},
	});

	const createMutation = useMutation({
		mutationFn: (data: CreateChangePolicyInput) => createChangePolicy(organizationId, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.changePolicies.created", "Policy created successfully"));
				form.reset();
				onSuccess();
			} else {
				toast.error(
					result.error || t("settings.changePolicies.createFailed", "Failed to create policy"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.changePolicies.createFailed", "Failed to create policy"));
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, data }: { id: string; data: CreateChangePolicyInput }) =>
			updateChangePolicy(id, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.changePolicies.updated", "Policy updated successfully"));
				onSuccess();
			} else {
				toast.error(
					result.error || t("settings.changePolicies.updateFailed", "Failed to update policy"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.changePolicies.updateFailed", "Failed to update policy"));
		},
	});

	const isPending = createMutation.isPending || updateMutation.isPending;

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen && !isPending) {
			form.reset();
		}
		onOpenChange(newOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.changePolicies.editTitle", "Edit Change Policy")
							: t("settings.changePolicies.createTitle", "Create Change Policy")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.changePolicies.dialogDescription",
							"Configure when employees can edit their time entries and when approval is required.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Name */}
					<form.Field name="name">
						{(field) => (
							<TFormItem>
								<TFormLabel required>
									{t("settings.changePolicies.nameLabel", "Policy Name")}
								</TFormLabel>
								<TFormControl>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.changePolicies.namePlaceholder",
											"e.g., Standard Policy",
										)}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Description */}
					<form.Field name="description">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t("settings.changePolicies.descriptionLabel", "Description")}
								</TFormLabel>
								<TFormControl>
									<Textarea
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.changePolicies.descriptionPlaceholder",
											"Optional description for this policy",
										)}
										rows={2}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Trust Mode Switch */}
					<form.Field name="noApprovalRequired">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label htmlFor="trust-mode" className="text-base">
										{t("settings.changePolicies.trustModeLabel", "Trust Mode")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.changePolicies.trustModeDescription",
											"Allow employees to edit entries without any approval requirements",
										)}
									</p>
								</div>
								<Switch
									id="trust-mode"
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked)}
								/>
							</div>
						)}
					</form.Field>

					{/* Self-Service Days */}
					<form.Subscribe selector={(state) => state.values.noApprovalRequired}>
						{(noApprovalRequired) =>
							!noApprovalRequired && (
								<>
									<form.Field name="selfServiceDays">
										{(field) => (
											<TFormItem>
												<TFormLabel>
													{t(
														"settings.changePolicies.selfServiceDaysLabel",
														"Self-Service Window (days)",
													)}
												</TFormLabel>
												<TFormControl>
													<Input
														type="number"
														min={0}
														value={field.state.value}
														onChange={(e) => field.handleChange(Number(e.target.value))}
														onBlur={field.handleBlur}
													/>
												</TFormControl>
												<TFormDescription>
													{t(
														"settings.changePolicies.selfServiceDaysDescription",
														"Employees can freely edit entries within this window. 0 = same day only.",
													)}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>

									{/* Approval Days */}
									<form.Field name="approvalDays">
										{(field) => (
											<TFormItem>
												<TFormLabel>
													{t("settings.changePolicies.approvalDaysLabel", "Approval Window (days)")}
												</TFormLabel>
												<TFormControl>
													<Input
														type="number"
														min={0}
														value={field.state.value}
														onChange={(e) => field.handleChange(Number(e.target.value))}
														onBlur={field.handleBlur}
													/>
												</TFormControl>
												<TFormDescription>
													{t(
														"settings.changePolicies.approvalDaysDescription",
														"Beyond self-service, employees can request changes within this window (requires approval). 0 = no additional window.",
													)}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>

									{/* Policy Summary */}
									<form.Subscribe
										selector={(state) => [state.values.selfServiceDays, state.values.approvalDays]}
									>
										{([selfServiceDays, approvalDays]) => (
											<div className="rounded-lg bg-muted p-3 text-sm">
												<p className="font-medium mb-1">
													{t("settings.changePolicies.policySummary", "Policy Summary:")}
												</p>
												{selfServiceDays === 0 && approvalDays === 0 ? (
													<p className="text-muted-foreground">
														{t(
															"settings.changePolicies.zeroDayPolicy",
															"Every clock-out will require manager approval (strictest mode).",
														)}
													</p>
												) : (
													<ul className="text-muted-foreground space-y-1">
														<li>
															•{" "}
															{selfServiceDays === 0
																? t(
																		"settings.changePolicies.sameDayFree",
																		"Same-day edits are free",
																	)
																: t(
																		"settings.changePolicies.daysFree",
																		"Edits within {days} days are free",
																		{ days: selfServiceDays },
																	)}
														</li>
														{approvalDays > 0 && (
															<li>
																•{" "}
																{t(
																	"settings.changePolicies.daysApproval",
																	"Days {start}-{end} require approval",
																	{
																		start: selfServiceDays + 1,
																		end: selfServiceDays + approvalDays,
																	},
																)}
															</li>
														)}
														<li>
															•{" "}
															{t(
																"settings.changePolicies.beyondWindow",
																"Beyond {days} days: only admins/team leads can edit",
																{ days: selfServiceDays + approvalDays },
															)}
														</li>
													</ul>
												)}
											</div>
										)}
									</form.Subscribe>

									{/* Notify All Managers */}
									<form.Field name="notifyAllManagers">
										{(field) => (
											<div className="flex items-center justify-between rounded-lg border p-4">
												<div className="space-y-0.5">
													<Label htmlFor="notify-all" className="text-base">
														{t("settings.changePolicies.notifyAllLabel", "Notify All Managers")}
													</Label>
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.changePolicies.notifyAllDescription",
															"When off, only the primary manager receives approval requests",
														)}
													</p>
												</div>
												<Switch
													id="notify-all"
													checked={field.state.value}
													onCheckedChange={(checked) => field.handleChange(checked)}
												/>
											</div>
										)}
									</form.Field>
								</>
							)
						}
					</form.Subscribe>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting]}>
							{([isDirty, isSubmitting]) => (
								<Button type="submit" disabled={(!isDirty && isEditing) || isPending}>
									{isPending && <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />}
									{isEditing
										? t("common.saveChanges", "Save Changes")
										: t("common.create", "Create")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
