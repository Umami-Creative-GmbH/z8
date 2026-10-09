"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { startPayslipBatchAction } from "@/app/[locale]/(app)/personnel-files/payslip-batches/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { DocumentVisibility, PayPeriod } from "@/lib/personnel-file/document.types";
import { useRouter } from "@/navigation";
import { usePersonnelFileLabels } from "./document-labels";

const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

interface StartValues {
	payPeriodMonth: string;
	payPeriodYear: string;
	visibility: DocumentVisibility;
}

/** Starts a payslip batch (#868): the pay period, picked once, and the visibility of every payslip. */
export function PayslipBatchStart({ defaultPayPeriod }: { defaultPayPeriod: PayPeriod }) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const router = useRouter();
	const required = t("settings.personnelFiles.form.payPeriod", "Pay period");

	const form = useForm({
		defaultValues: {
			payPeriodMonth: String(defaultPayPeriod.month),
			payPeriodYear: String(defaultPayPeriod.year),
			visibility: "shared",
		} as StartValues,
		onSubmit: async ({ value }) => {
			const result = await startPayslipBatchAction({
				payPeriod: { year: Number(value.payPeriodYear), month: Number(value.payPeriodMonth) },
				visibility: value.visibility,
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			router.push(`/personnel-files/payslip-batches/${result.data.id}`);
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.personnelFiles.batch.startTitle", "Start a payslip batch")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.batch.startDescription",
						"Pick the pay period once for all payslips of the batch. Nothing is saved to personnel files until you confirm the matches.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-5 sm:max-w-md"
					action={() => {
						void form.handleSubmit();
					}}
				>
					<div className="grid grid-cols-2 gap-3">
						<form.Field name="payPeriodMonth">
							{(field) => (
								<TFormItem>
									<TFormLabel required>
										{t("settings.personnelFiles.form.payPeriodMonth", "Pay period month")}
									</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value)}
									>
										<TFormControl>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{MONTHS.map((month) => (
												<SelectItem key={month} value={month}>
													{month.padStart(2, "0")}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="payPeriodYear"
							validators={{
								onSubmit: ({ value }) =>
									/^\d{4}$/.test(value)
										? undefined
										: t("settings.personnelFiles.form.required", "{label} is required", {
												label: required,
											}),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.personnelFiles.form.payPeriodYear", "Pay period year")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											inputMode="numeric"
											value={field.state.value}
											maxLength={4}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>
					<form.Field name="visibility">
						{(field) => (
							<TFormItem>
								<TFormLabel required>
									{t("settings.personnelFiles.form.visibility", "Visibility")}
								</TFormLabel>
								<Select
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value as DocumentVisibility)}
								>
									<TFormControl>
										<SelectTrigger className="w-full" onBlur={field.handleBlur}>
											<SelectValue />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="shared">{labels.visibilities.shared}</SelectItem>
										<SelectItem value="hr_only">{labels.visibilities.hr_only}</SelectItem>
									</SelectContent>
								</Select>
								<TFormDescription>
									{field.state.value === "shared"
										? t(
												"settings.personnelFiles.batch.sharedHint",
												"Employees see their payslip under My Documents and get one notification for the batch.",
											)
										: t(
												"settings.personnelFiles.batch.hrOnlyHint",
												"Only you and other personnel file officers see the payslips. Employees are not notified.",
											)}
								</TFormDescription>
							</TFormItem>
						)}
					</form.Field>
					<div>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : null}
									{t("settings.personnelFiles.batch.start", "Start batch")}
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
