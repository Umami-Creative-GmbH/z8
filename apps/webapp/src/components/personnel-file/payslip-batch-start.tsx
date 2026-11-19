"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { startPayslipBatchAction } from "@/app/[locale]/(app)/personnel-files/payslip-batches/actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
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
import type {
	DocumentVisibility,
	PayPeriod,
} from "@/lib/personnel-file/document.types";
import { useRouter } from "@/navigation";
import { usePersonnelFileLabels } from "./document-labels";

const MONTHS = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"10",
	"11",
	"12",
] as const;

interface StartValues {
	payPeriodMonth: string;
	payPeriodYear: string;
	visibility: DocumentVisibility;
}

/** Starts a payslip batch (#868): the pay period, picked once, and the visibility of every payslip. */
export function PayslipBatchStart({
	defaultPayPeriod,
	expectedScope,
}: {
	defaultPayPeriod: PayPeriod;
	expectedScope: { userId: string; organizationId: string };
}) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const lifetime = useRef<object | null>(null);
	const intent = useRef<object | null>(null);
	const yearInput = useRef<HTMLInputElement>(null);
	useLayoutEffect(() => {
		lifetime.current = {
			userId: expectedScope.userId,
			organizationId: expectedScope.organizationId,
		};
		return () => {
			lifetime.current = null;
		};
	}, [expectedScope.userId, expectedScope.organizationId]);
	const required = t("settings.personnelFiles.form.payPeriod", "Pay period");

	const form = useForm({
		defaultValues: {
			payPeriodMonth: String(defaultPayPeriod.month),
			payPeriodYear: String(defaultPayPeriod.year),
			visibility: "shared",
		} as StartValues,
		onSubmit: async ({ value }) => {
			const started = intent.current;
			if (!started || started !== lifetime.current) return;
			setError(null);
			try {
				const result = await startPayslipBatchAction({
					payPeriod: {
						year: Number(value.payPeriodYear),
						month: Number(value.payPeriodMonth),
					},
					visibility: value.visibility,
					expectedScope,
				});
				if (started !== lifetime.current) return;
				if (!result.success) {
					toast.error(result.error);
					setError(result.error);
					return;
				}
				router.push(`/personnel-files/payslip-batches/${result.data.id}`);
			} catch {
				if (started !== lifetime.current) return;
				setError(
					t(
						"settings.personnelFiles.batch.startFailed",
						"The batch could not be confirmed. Check your batch history before trying again. Your choices are kept.",
					),
				);
			}
		},
	});

	return (
		<Card>
			<CardHeader>
				<h2 className="text-lg font-semibold tracking-tight">
					{t(
						"settings.personnelFiles.batch.startTitle",
						"Start a payslip batch",
					)}
				</h2>
				<CardDescription>
					{t(
						"settings.personnelFiles.batch.startConsequences",
						"Starting a batch saves no personnel documents and sends no notifications. Next, upload payslips and review the matches before confirming.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!lifetime.current || form.state.isSubmitting) return;
						intent.current = lifetime.current;
						const started = lifetime.current;
						await form.handleSubmit();
						if (
							started === lifetime.current &&
							form.state.fieldMeta.payPeriodYear?.errors.length
						)
							yearInput.current?.focus();
					}}
				>
					<div className="grid grid-cols-2 gap-3">
						<form.Field name="payPeriodMonth">
							{(field) => (
								<TFormItem>
									<TFormLabel required>
										{t(
											"settings.personnelFiles.form.payPeriodMonth",
											"Pay period month",
										)}
									</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value)}
									>
										<TFormControl>
											<SelectTrigger
												className="w-full"
												onBlur={field.handleBlur}
											>
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
										: t(
												"settings.personnelFiles.form.required",
												"{label} is required",
												{
													label: required,
												},
											),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t(
											"settings.personnelFiles.form.payPeriodYear",
											"Pay period year",
										)}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											ref={yearInput}
											name="payPeriodYear"
											autoComplete="off"
											inputMode="numeric"
											value={field.state.value}
											maxLength={4}
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
					</div>
					<form.Field name="visibility">
						{(field) => (
							<TFormItem>
								<TFormLabel required>
									{t("settings.personnelFiles.form.visibility", "Visibility")}
								</TFormLabel>
								<Select
									value={field.state.value}
									onValueChange={(value) =>
										field.handleChange(value as DocumentVisibility)
									}
								>
									<TFormControl>
										<SelectTrigger className="w-full" onBlur={field.handleBlur}>
											<SelectValue />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="shared">
											{labels.visibilities.shared}
										</SelectItem>
										<SelectItem value="hr_only">
											{labels.visibilities.hr_only}
										</SelectItem>
									</SelectContent>
								</Select>
								<TFormDescription>
									{field.state.value === "shared"
										? t(
												"settings.personnelFiles.batch.sharedAfterConfirmation",
												"After confirmation, employees see their payslips under My Documents and receive one notification for the batch.",
											)
										: t(
												"settings.personnelFiles.batch.hrOnlyAfterConfirmation",
												"After confirmation, only authorized personnel file officers and admins see the payslips. Employees are not notified.",
											)}
								</TFormDescription>
							</TFormItem>
						)}
					</form.Field>
					<div className="md:col-span-2">
						{error ? (
							<p role="alert" className="mb-3 text-sm text-destructive">
								{error}
							</p>
						) : null}
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2
											aria-hidden="true"
											className="size-4 animate-spin motion-reduce:animate-none"
										/>
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
