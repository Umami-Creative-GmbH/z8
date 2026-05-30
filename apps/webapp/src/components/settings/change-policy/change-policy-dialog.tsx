"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type ChangePolicyRecord,
	type CreateChangePolicyInput,
	createChangePolicy,
	updateChangePolicy,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
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
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";

interface ChangePolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingPolicy: ChangePolicyRecord | null;
	onSuccess: () => void;
}

interface ChangePolicyFormValues {
	name: string;
	description: string;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired: boolean;
	notifyAllManagers: boolean;
}

const defaultValues: ChangePolicyFormValues = {
	name: "",
	description: "",
	selfServiceDays: 0,
	approvalDays: 7,
	noApprovalRequired: false,
	notifyAllManagers: false,
};

function useChangePolicyForm({
	initialValues,
	onSubmit,
}: {
	initialValues: ChangePolicyFormValues;
	onSubmit: (value: ChangePolicyFormValues) => void;
}) {
	return useForm({
		defaultValues: initialValues satisfies ChangePolicyFormValues,
		onSubmit: async ({ value }) => onSubmit(value),
	});
}

function ChangePolicyDialogFields({
	form,
	t,
}: {
	form: ReturnType<typeof useChangePolicyForm>;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<ActionPanelBody className="space-y-4">
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
												onChange={(e) =>
													field.handleChange(Number(e.target.value))
												}
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

							<form.Field name="approvalDays">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t(
												"settings.changePolicies.approvalDaysLabel",
												"Approval Window (days)",
											)}
										</TFormLabel>
										<TFormControl>
											<Input
												type="number"
												min={0}
												value={field.state.value}
												onChange={(e) =>
													field.handleChange(Number(e.target.value))
												}
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

							<form.Subscribe
								selector={(state) => [
									state.values.selfServiceDays,
									state.values.approvalDays,
								]}
							>
								{([selfServiceDays, approvalDays]) => (
									<div className="rounded-lg bg-muted p-3 text-sm">
										<p className="font-medium mb-1">
											{t(
												"settings.changePolicies.policySummary",
												"Policy Summary:",
											)}
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
														{
															days: selfServiceDays + approvalDays,
														},
													)}
												</li>
											</ul>
										)}
									</div>
								)}
							</form.Subscribe>

							<form.Field name="notifyAllManagers">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label htmlFor="notify-all" className="text-base">
												{t(
													"settings.changePolicies.notifyAllLabel",
													"Notify All Managers",
												)}
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
		</ActionPanelBody>
	);
}

export function ChangePolicyDialog({
	open,
	onOpenChange,
	organizationId,
	editingPolicy,
	onSuccess,
}: ChangePolicyDialogProps) {
	// eslint-disable-next-line react-doctor/no-giant-component
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!editingPolicy;

	const form = useChangePolicyForm({
		initialValues: editingPolicy
			? {
					name: editingPolicy.name,
					description: editingPolicy.description ?? "",
					selfServiceDays: editingPolicy.selfServiceDays,
					approvalDays: editingPolicy.approvalDays,
					noApprovalRequired: editingPolicy.noApprovalRequired,
					notifyAllManagers: editingPolicy.notifyAllManagers,
				}
			: defaultValues,
		onSubmit: (value) => {
			if (isEditing) {
				updateMutation.mutate({ id: editingPolicy.id, data: value });
			} else {
				createMutation.mutate(value);
			}
		},
	});

	const createMutation = useMutation({
		mutationFn: (data: CreateChangePolicyInput) =>
			createChangePolicy(organizationId, data),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.list(organizationId),
				});
				toast.success(
					t("settings.changePolicies.created", "Policy created successfully"),
				);
				form.reset();
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t(
							"settings.changePolicies.createFailed",
							"Failed to create policy",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.changePolicies.createFailed", "Failed to create policy"),
			);
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, data }: { id: string; data: CreateChangePolicyInput }) =>
			updateChangePolicy(id, data),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.list(organizationId),
				});
				toast.success(
					t("settings.changePolicies.updated", "Policy updated successfully"),
				);
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t(
							"settings.changePolicies.updateFailed",
							"Failed to update policy",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.changePolicies.updateFailed", "Failed to update policy"),
			);
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
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.changePolicies.editTitle", "Edit Change Policy")
							: t(
									"settings.changePolicies.createTitle",
									"Create Change Policy",
								)}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.changePolicies.dialogDescription",
							"Configure when employees can edit their time entries and when approval is required.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={form.handleSubmit}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ChangePolicyDialogFields form={form} t={t} />

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe
							selector={(state) => [state.isDirty, state.isSubmitting]}
						>
							{([isDirty, _isSubmitting]) => (
								<Button
									type="submit"
									disabled={(!isDirty && isEditing) || isPending}
								>
									{isPending && (
										<IconLoader2 className="size-4 mr-2 animate-spin" />
									)}
									{isEditing
										? t("common.saveChanges", "Save Changes")
										: t("common.create", "Create")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
