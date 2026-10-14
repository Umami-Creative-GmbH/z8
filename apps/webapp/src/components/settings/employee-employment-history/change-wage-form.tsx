import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { type ChangeHourlyWage, hourlyWageSchema } from "@/lib/validations/employment-history";
import type { MutationResult } from "./types";

type ChangeWageValues = {
	effectiveOn: string;
	hourlyRate: string;
	changeReason: string;
	saveAsDraft: boolean;
};

const defaultValues: ChangeWageValues = {
	effectiveOn: "",
	hourlyRate: "",
	changeReason: "",
	saveAsDraft: false,
};

/**
 * "Change wage": new hourly terms from a date that copy every other field from
 * the terms in force then (the server copies them). Confirmed unless the
 * admin saves a draft.
 */
export function ChangeWageForm({
	onSubmit,
	isPending,
	onClose,
}: {
	onSubmit: (data: ChangeHourlyWage) => Promise<MutationResult>;
	isPending: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const draftCheckboxId = useId();
	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			const result = await onSubmit({
				effectiveOn: value.effectiveOn,
				hourlyRate: value.hourlyRate.trim(),
				changeReason: value.changeReason.trim(),
				reviewState: value.saveAsDraft ? "draft" : "confirmed",
			}).catch(() => null);
			if (!result) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			if (result.success) {
				toast.success(
					value.saveAsDraft
						? t(
								"settings.employmentHistory.changeWage.draftSuccess",
								"Wage change saved as a draft",
							)
						: t("settings.employmentHistory.changeWage.success", "Wage changed"),
				);
				form.reset();
				onClose();
				return;
			}
			toast.error(
				result.error ||
					t("settings.employmentHistory.changeWage.error", "Failed to change the wage"),
			);
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
			className="rounded-lg border bg-muted/20 p-4"
			aria-label={t("settings.employmentHistory.changeWage.title", "Change wage")}
		>
			<p className="mb-4 text-sm text-muted-foreground">
				{t(
					"settings.employmentHistory.changeWage.description",
					"Creates new terms from this date. Contract type, weekly hours, work model, work policy and currency are copied from the terms in force on that date.",
				)}
			</p>
			<div className="grid gap-4 md:grid-cols-2">
				<form.Field
					name="effectiveOn"
					validators={{
						onSubmit: ({ value }) =>
							value
								? undefined
								: t(
										"settings.employmentHistory.changeWage.validFromRequired",
										"Valid from is required",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.employmentHistory.changeWage.validFrom", "Valid from")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="effectiveOn"
									type="date"
									autoComplete="off"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									disabled={isPending}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="hourlyRate"
					validators={{
						onSubmit: ({ value }) =>
							hourlyWageSchema.safeParse(value).success
								? undefined
								: t(
										"settings.employmentHistory.changeWage.wageInvalid",
										"Hourly rate must be a positive number",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.employmentHistory.changeWage.newWage", "New hourly wage")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="hourlyRate"
									inputMode="decimal"
									autoComplete="off"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									disabled={isPending}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.employmentHistory.changeWage.currencyHint",
									"In the currency of the terms in force",
								)}
							</TFormDescription>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field
				name="changeReason"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t("settings.employmentHistory.changeWage.reasonRequired", "Reason is required"),
				}}
			>
				{(field) => (
					<TFormItem className="mt-4">
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.employmentHistory.changeWage.reason", "Reason")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="changeReason"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								disabled={isPending}
								autoComplete="off"
								rows={2}
								maxLength={1000}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="saveAsDraft">
				{(field) => (
					<div className="mt-4 flex items-center gap-2">
						<Checkbox
							id={draftCheckboxId}
							checked={field.state.value}
							onCheckedChange={(checked) => field.handleChange(checked === true)}
							disabled={isPending}
						/>
						<Label htmlFor={draftCheckboxId}>
							{t("settings.employmentHistory.changeWage.saveAsDraft", "Save as draft")}
						</Label>
					</div>
				)}
			</form.Field>
			<div className="mt-4 flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
					{t("settings.employmentHistory.changeWage.save", "Save wage change")}
				</Button>
			</div>
		</form>
	);
}
