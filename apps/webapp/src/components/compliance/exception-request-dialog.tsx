"use client";

import { IconAlertTriangle, IconClock, IconLoader2, IconShield } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { toast } from "sonner";
import { requestComplianceException } from "@/app/[locale]/(app)/settings/compliance/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { ClientForm } from "@/components/ui/client-form";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { queryKeys } from "@/lib/query/keys";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Textarea } from "../ui/textarea";

type ExceptionType = "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";

interface ExceptionRequestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultExceptionType?: string;
	employeeId?: string;
	organizationId?: string;
	onSuccess?: () => void;
}

interface ExceptionRequestFormValues {
	exceptionType: ExceptionType;
	reason: string;
	plannedHours: string;
	plannedMinutes: string;
}

const exceptionTypes = [
	{
		value: "rest_period",
		label: "Rest Period Exception",
		description: "Request to clock in before completing the 11-hour rest period",
		icon: IconClock,
	},
	{
		value: "overtime_daily",
		label: "Daily Overtime",
		description: "Request to work beyond the daily overtime threshold",
		icon: IconAlertTriangle,
	},
	{
		value: "overtime_weekly",
		label: "Weekly Overtime",
		description: "Request to work beyond the weekly overtime threshold",
		icon: IconAlertTriangle,
	},
	{
		value: "overtime_monthly",
		label: "Monthly Overtime",
		description: "Request to work beyond the monthly overtime threshold",
		icon: IconAlertTriangle,
	},
] as const;

function resolveExceptionType(value?: string): ExceptionType {
	switch (value) {
		case "overtime_daily":
		case "overtime_weekly":
		case "overtime_monthly":
			return value;
		default:
			return "rest_period";
	}
}

export function ExceptionRequestDialog(props: ExceptionRequestDialogProps) {
	return (
		<ExceptionRequestDialogContent
			key={`${String(props.open)}:${props.defaultExceptionType ?? "rest_period"}`}
			{...props}
		/>
	);
}

function ExceptionRequestDialogContent({
	open,
	onOpenChange,
	defaultExceptionType,
	employeeId = "current",
	organizationId,
	onSuccess,
}: ExceptionRequestDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const submittingRef = useRef(false);

	const requestMutation = useMutation({
		mutationFn: async (values: ExceptionRequestFormValues) => {
			const plannedDurationMinutes =
				values.exceptionType === "rest_period"
					? 0
					: (parseInt(values.plannedHours, 10) || 0) * 60 +
						(parseInt(values.plannedMinutes, 10) || 0);

			const result = await requestComplianceException({
				exceptionType: values.exceptionType,
				reason: values.reason.trim(),
				plannedDurationMinutes: plannedDurationMinutes > 0 ? plannedDurationMinutes : undefined,
			});

			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
	});

	const validateReason = (value: string) =>
		value.trim()
			? undefined
			: t(
					"compliance:compliance.exception.reasonRequiredDescription",
					"Please provide a reason for your exception request.",
				);

	const validateHours = (value: string, exceptionType: ExceptionType) => {
		if (exceptionType === "rest_period" || !value.trim()) return undefined;
		const parsed = Number(value);
		return Number.isInteger(parsed) && parsed >= 0 && parsed <= 12
			? undefined
			: t(
					"compliance:compliance.exception.plannedHoursInvalid",
					"Enter whole hours between 0 and 12.",
				);
	};

	const validateMinutes = (value: string, exceptionType: ExceptionType) => {
		if (exceptionType === "rest_period" || !value.trim()) return undefined;
		const parsed = Number(value);
		return Number.isInteger(parsed) && parsed >= 0 && parsed <= 59
			? undefined
			: t(
					"compliance:compliance.exception.plannedMinutesInvalid",
					"Enter whole minutes between 0 and 59.",
				);
	};

	const form = useForm({
		defaultValues: {
			exceptionType: resolveExceptionType(defaultExceptionType),
			reason: "",
			plannedHours: "",
			plannedMinutes: "",
		} satisfies ExceptionRequestFormValues,
		onSubmit: async ({ value, formApi }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					await requestMutation.mutateAsync(value);
					toast.success(
						t("compliance:compliance.exception.requestSubmitted", "Exception Request Submitted"),
						{
							description: t(
								"compliance:compliance.exception.requestSubmittedDescription",
								"Your manager will be notified and can approve or reject your request.",
							),
						},
					);
					void queryClient.invalidateQueries({
						queryKey: queryKeys.compliance.exceptions.my(employeeId, false),
					});
					if (organizationId) {
						void queryClient.invalidateQueries({
							queryKey: queryKeys.compliance.pendingExceptions(organizationId),
						});
					}
					formApi.reset();
					onOpenChange(false);
					onSuccess?.();
				} catch (error) {
					toast.error(t("compliance:compliance.exception.requestFailed", "Request Failed"), {
						description: error instanceof Error ? error.message : String(error),
					});
				}
			};

			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await run().finally(() => {
				submittingRef.current = false;
			});
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && submittingRef.current) return;
		onOpenChange(nextOpen);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				size="compact"
				onEscapeKeyDown={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
			>
				<ClientForm
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					onSubmit={() => {
						if (submittingRef.current) return;
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle className="flex items-center gap-2">
							<IconShield className="size-5" aria-hidden="true" />
							{t("compliance:compliance.exception.requestTitle", "Request Compliance Exception")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"compliance:compliance.exception.requestDescription",
								"Request pre-approval from your manager to proceed despite compliance restrictions. Approved exceptions are valid for 24 hours.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
						{/* Exception Type Selection */}
						<form.Field name="exceptionType">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("compliance:compliance.exception.type", "Exception Type")}</Label>
									<RadioGroup
										value={field.state.value}
										onValueChange={(value) => field.handleChange(resolveExceptionType(value))}
										className="space-y-2"
									>
										{exceptionTypes.map((type) => {
											const Icon = type.icon;
											return (
												<label
													key={type.value}
													className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5"
												>
													<RadioGroupItem value={type.value} className="mt-0.5" />
													<div className="flex-1 space-y-0.5">
														<div className="flex items-center gap-1.5 font-medium">
															<Icon className="size-4" aria-hidden="true" />
															{type.label}
														</div>
														<p className="text-xs text-muted-foreground">{type.description}</p>
													</div>
												</label>
											);
										})}
									</RadioGroup>
								</div>
							)}
						</form.Field>

						{/* Reason */}
						<form.Field
							name="reason"
							validators={{
								onSubmit: ({ value }) => validateReason(value),
								onChange: ({ value, fieldApi }) =>
									fieldApi.state.meta.errors.length > 0 ? validateReason(value) : undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("compliance:compliance.exception.reason", "Reason for Exception")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="reason"
											placeholder={t(
												"compliance:compliance.exception.reasonPlaceholder",
												"Explain why you need this exception (e.g., urgent project deadline, critical client meeting)...",
											)}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											rows={3}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{/* Planned Duration (optional) */}
						<form.Subscribe selector={(state) => state.values.exceptionType}>
							{(exceptionType) =>
								exceptionType !== "rest_period" ? (
									<div className="space-y-2">
										<Label>
											{t(
												"compliance:compliance.exception.plannedDuration",
												"Planned Additional Duration",
											)}{" "}
											<span className="text-muted-foreground">
												({t("common.optional", "optional")})
											</span>
										</Label>
										<div className="flex flex-wrap items-start gap-3">
											<form.Field
												name="plannedHours"
												validators={{
													onSubmit: ({ value }) => validateHours(value, exceptionType),
													onChange: ({ value, fieldApi }) =>
														fieldApi.state.meta.errors.length > 0
															? validateHours(value, exceptionType)
															: undefined,
												}}
											>
												{(field) => (
													<TFormItem className="gap-1">
														<div className="flex items-center gap-1">
															<TFormControl hasError={fieldHasError(field)}>
																<Input
																	type="number"
																	name="plannedHours"
																	aria-label={t(
																		"compliance:compliance.exception.plannedHours",
																		"Planned hours",
																	)}
																	autoComplete="off"
																	min="0"
																	max="12"
																	value={field.state.value}
																	onChange={(e) => field.handleChange(e.target.value)}
																	onBlur={field.handleBlur}
																	className="w-16"
																	placeholder="0"
																/>
															</TFormControl>
															<span className="text-sm text-muted-foreground">h</span>
														</div>
														<TFormMessage field={field} />
													</TFormItem>
												)}
											</form.Field>
											<form.Field
												name="plannedMinutes"
												validators={{
													onSubmit: ({ value }) => validateMinutes(value, exceptionType),
													onChange: ({ value, fieldApi }) =>
														fieldApi.state.meta.errors.length > 0
															? validateMinutes(value, exceptionType)
															: undefined,
												}}
											>
												{(field) => (
													<TFormItem className="gap-1">
														<div className="flex items-center gap-1">
															<TFormControl hasError={fieldHasError(field)}>
																<Input
																	type="number"
																	name="plannedMinutes"
																	aria-label={t(
																		"compliance:compliance.exception.plannedMinutes",
																		"Planned minutes",
																	)}
																	autoComplete="off"
																	min="0"
																	max="59"
																	value={field.state.value}
																	onChange={(e) => field.handleChange(e.target.value)}
																	onBlur={field.handleBlur}
																	className="w-16"
																	placeholder="0"
																/>
															</TFormControl>
															<span className="text-sm text-muted-foreground">m</span>
														</div>
														<TFormMessage field={field} />
													</TFormItem>
												)}
											</form.Field>
										</div>
										<p className="text-xs text-muted-foreground">
											{t(
												"compliance:compliance.exception.plannedDurationHelp",
												"Estimate how much additional time you expect to need beyond the limit.",
											)}
										</p>
									</div>
								) : null
							}
						</form.Subscribe>
					</ActionPanelBody>

					<ActionPanelFooter>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<>
									<Button
										type="button"
										variant="outline"
										disabled={isSubmitting}
										onClick={() => handleOpenChange(false)}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting && (
											<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
										)}
										{isSubmitting
											? t("common.submitting", "Submitting…")
											: t("compliance:compliance.exception.submit", "Submit Request")}
									</Button>
								</>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</ClientForm>
			</ActionPanelContent>
		</ActionPanel>
	);
}
