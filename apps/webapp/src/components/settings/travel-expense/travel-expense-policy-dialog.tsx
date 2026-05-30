"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type TravelExpensePolicyData,
	upsertTravelExpensePolicy,
} from "@/app/[locale]/(app)/settings/travel-expenses/actions";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import {
	getTravelExpensePolicyFormValues,
	normalizePolicyFormValues,
} from "./travel-expense-policy-dialog-utils";

interface TravelExpensePolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editingPolicy: TravelExpensePolicyData | null;
	onSuccess: () => void | Promise<void>;
}

export function TravelExpensePolicyDialog({
	open,
	onOpenChange,
	editingPolicy,
	onSuccess,
}: TravelExpensePolicyDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!editingPolicy;

	const form = useForm({
		defaultValues: getTravelExpensePolicyFormValues(editingPolicy),
		onSubmit: async ({ value }) => {
			if (!value.effectiveFrom) {
				toast.error(
					t("settings.travelExpenses.effectiveFromRequired", "Effective from is required"),
				);
				return;
			}

			const normalized = normalizePolicyFormValues(value);
			await mutation.mutateAsync({
				...normalized,
				id: editingPolicy?.id,
			});
		},
	});

	const mutation = useMutation({
		mutationFn: upsertTravelExpensePolicy,
		onSuccess: async (result) => {
			if (!result.success) {
				toast.error(
					result.error ||
						t("settings.travelExpenses.saveFailed", "Failed to save travel expense policy"),
				);
				return;
			}

			queryClient.invalidateQueries();
			toast.success(
				isEditing
					? t("settings.travelExpenses.updated", "Travel expense policy updated")
					: t("settings.travelExpenses.created", "Travel expense policy created"),
			);
			await onSuccess();
		},
		onError: () => {
			toast.error(t("settings.travelExpenses.saveFailed", "Failed to save travel expense policy"));
		},
	});

	const isPending = mutation.isPending;

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.travelExpenses.editPolicy", "Edit Travel Expense Policy")
							: t("settings.travelExpenses.createPolicy", "Create Travel Expense Policy")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.travelExpenses.dialogDescription",
							"Set effective dates and default reimbursement rates for mileage and per diem claims.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-4">
						<div className="grid grid-cols-2 gap-3">
							<form.Field name="effectiveFrom">
								{(field) => (
									<TFormItem>
										<TFormLabel required>
											{t("settings.travelExpenses.effectiveFrom", "Effective From")}
										</TFormLabel>
										<TFormControl>
											<DatePicker
												name="effectiveFrom"
												value={field.state.value}
												onChange={field.handleChange}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="effectiveTo">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("settings.travelExpenses.effectiveTo", "Effective To")}
										</TFormLabel>
										<TFormControl>
											<DatePicker
												name="effectiveTo"
												value={field.state.value}
												onChange={field.handleChange}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</div>

						<form.Field name="currency">
							{(field) => (
								<TFormItem>
									<TFormLabel required>
										{t("settings.travelExpenses.currency", "Currency")}
									</TFormLabel>
									<TFormControl>
										<Input
											name="currency"
											autoComplete="off"
											maxLength={3}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
											onBlur={field.handleBlur}
											placeholder="EUR"
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<div className="grid grid-cols-2 gap-3">
							<form.Field name="mileageRatePerKm">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("settings.travelExpenses.mileageRate", "Mileage Rate per km")}
										</TFormLabel>
										<TFormControl>
											<Input
												name="mileageRatePerKm"
												autoComplete="off"
												type="number"
												step="0.01"
												min="0"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="perDiemRatePerDay">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("settings.travelExpenses.perDiemRate", "Per Diem Rate per day")}
										</TFormLabel>
										<TFormControl>
											<Input
												name="perDiemRatePerDay"
												autoComplete="off"
												type="number"
												step="0.01"
												min="0"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</div>

						<form.Field name="isActive">
							{(field) => (
								<div className="flex items-center justify-between rounded-lg border p-4">
									<div className="space-y-0.5">
										<Label htmlFor="is-active" className="text-base">
											{t("settings.travelExpenses.activeLabel", "Active Policy")}
										</Label>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.travelExpenses.activeDescription",
												"When enabled, this policy becomes the active default for new claims.",
											)}
										</p>
									</div>
									<Switch
										id="is-active"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="button" onClick={() => form.handleSubmit()} disabled={isPending}>
							{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{isEditing ? t("common.saveChanges", "Save Changes") : t("common.create", "Create")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
