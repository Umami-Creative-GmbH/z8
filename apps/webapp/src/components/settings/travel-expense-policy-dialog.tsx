"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	type TravelExpensePolicyData,
	type UpsertTravelExpensePolicyInput,
} from "@/app/[locale]/(app)/settings/travel-expenses/actions";
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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";

interface TravelExpensePolicyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editingPolicy: TravelExpensePolicyData | null;
	onSuccess: () => void | Promise<void>;
}

export interface TravelExpensePolicyFormValues {
	effectiveFrom: string;
	effectiveTo: string;
	currency: string;
	mileageRatePerKm: string;
	perDiemRatePerDay: string;
	isActive: boolean;
}

function toDateInputValue(value: Date | string | null): string {
	if (!value) {
		return "";
	}

	if (value instanceof Date) {
		const dt = DateTime.fromJSDate(value);
		return dt.isValid ? dt.toFormat("yyyy-LL-dd") : "";
	}

	const dt = DateTime.fromISO(value);
	return dt.isValid ? dt.toFormat("yyyy-LL-dd") : "";
}

function toNumberInputValue(value: string | null): string {
	if (value === null) {
		return "";
	}

	const amount = Number(value);
	return Number.isFinite(amount) ? String(amount) : "";
}

function defaultValues(policy: TravelExpensePolicyData | null): TravelExpensePolicyFormValues {
	if (!policy) {
		return {
			effectiveFrom: "",
			effectiveTo: "",
			currency: "EUR",
			mileageRatePerKm: "",
			perDiemRatePerDay: "",
			isActive: true,
		};
	}

	return {
		effectiveFrom: toDateInputValue(policy.effectiveFrom),
		effectiveTo: toDateInputValue(policy.effectiveTo),
		currency: policy.currency,
		mileageRatePerKm: toNumberInputValue(policy.mileageRatePerKm),
		perDiemRatePerDay: toNumberInputValue(policy.perDiemRatePerDay),
		isActive: policy.isActive,
	};
}

export function normalizePolicyFormValues(
	values: TravelExpensePolicyFormValues,
): Omit<UpsertTravelExpensePolicyInput, "id"> {
	const effectiveFrom = DateTime.fromISO(values.effectiveFrom).startOf("day").toJSDate();
	const effectiveToValue = values.effectiveTo.trim();
	const mileageValue = values.mileageRatePerKm.trim();
	const perDiemValue = values.perDiemRatePerDay.trim();

	return {
		effectiveFrom,
		effectiveTo: effectiveToValue
			? DateTime.fromISO(effectiveToValue).startOf("day").toJSDate()
			: null,
		currency: values.currency.trim().toUpperCase(),
		mileageRatePerKm: mileageValue === "" ? undefined : Number(mileageValue),
		perDiemRatePerDay: perDiemValue === "" ? undefined : Number(perDiemValue),
		isActive: values.isActive,
	};
}

export function TravelExpensePolicyDialog({
	open,
	onOpenChange,
	editingPolicy,
	onSuccess,
}: TravelExpensePolicyDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingPolicy;

	const form = useForm({
		defaultValues: defaultValues(editingPolicy),
		onSubmit: async ({ value }) => {
			if (!value.effectiveFrom) {
				toast.error(t("settings.travelExpenses.effectiveFromRequired", "Effective from is required"));
				return;
			}

			const normalized = normalizePolicyFormValues(value);
			await mutation.mutateAsync({
				...normalized,
				id: editingPolicy?.id,
			});
		},
	});

	useEffect(() => {
		if (open) {
			form.reset(defaultValues(editingPolicy));
		}
	}, [open, editingPolicy, form]);

	const mutation = useMutation({
		mutationFn: async (input: UpsertTravelExpensePolicyInput) => {
			const { upsertTravelExpensePolicy } = await import(
				"@/app/[locale]/(app)/settings/travel-expenses/actions"
			);
			return upsertTravelExpensePolicy(input);
		},
		onSuccess: async (result) => {
			if (!result.success) {
				toast.error(
					result.error ||
						t("settings.travelExpenses.saveFailed", "Failed to save travel expense policy"),
				);
				return;
			}

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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.travelExpenses.editPolicy", "Edit Travel Expense Policy")
							: t("settings.travelExpenses.createPolicy", "Create Travel Expense Policy")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.travelExpenses.dialogDescription",
							"Set effective dates and default reimbursement rates for mileage and per diem claims.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<div className="grid grid-cols-2 gap-3">
						<form.Field name="effectiveFrom">
							{(field) => (
								<TFormItem>
									<TFormLabel required>
										{t("settings.travelExpenses.effectiveFrom", "Effective From")}
									</TFormLabel>
									<TFormControl>
										<Input
											name="effectiveFrom"
											autoComplete="off"
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
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
										<Input
											name="effectiveTo"
											autoComplete="off"
											type="date"
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

					<form.Field name="currency">
						{(field) => (
							<TFormItem>
								<TFormLabel required>{t("settings.travelExpenses.currency", "Currency")}</TFormLabel>
							<TFormControl>
								<Input
									name="currency"
									autoComplete="off"
									maxLength={3}
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(event.target.value.toUpperCase())
										}
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

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing
								? t("common.saveChanges", "Save Changes")
								: t("common.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
