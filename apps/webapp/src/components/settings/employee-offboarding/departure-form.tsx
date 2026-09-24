"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-description";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import type { ServerActionResult } from "@/lib/effect/result";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";
import { useDeparturePreview, useRequestIdentity } from "@/lib/query/use-employee-offboarding";
import type {
	OffboardNowInput,
	ScheduleDepartureInput,
} from "@/lib/validations/employee-offboarding";
import { formatDepartureCutoff } from "./format";
import { useOffboardingLabels } from "./labels";

const NO_REPLACEMENT = "__none__";

export type DepartureFormValues = {
	mode: "scheduled" | "immediate";
	lastWorkingDay: string;
	replacementEmployeeId: string;
	acknowledgeUnassignedDuties: boolean;
};

export type DepartureFormProps = {
	organizationId: string;
	employeeId: string;
	/** The pending departure being edited, if any. */
	departure: EmployeeOffboardingView["departure"];
	initialMode: DepartureFormValues["mode"];
	canSchedule: boolean;
	canOffboardNow: boolean;
	scheduleDeparture: (input: ScheduleDepartureInput) => Promise<ServerActionResult<unknown>>;
	offboardNow: (input: OffboardNowInput) => Promise<ServerActionResult<unknown>>;
	onCompleted: () => void;
	onCancel: () => void;
};

export function DepartureForm(props: DepartureFormProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const requestIdentity = useRequestIdentity();
	const errorRef = useRef<HTMLDivElement>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const defaultValues: DepartureFormValues = {
		mode: props.canSchedule ? props.initialMode : "immediate",
		lastWorkingDay: props.departure?.lastWorkingDay ?? "",
		replacementEmployeeId: props.departure?.replacementEmployeeId ?? NO_REPLACEMENT,
		acknowledgeUnassignedDuties: false,
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setSubmitError(null);
			const replacementEmployeeId =
				value.replacementEmployeeId === NO_REPLACEMENT ? null : value.replacementEmployeeId;
			const result =
				value.mode === "immediate"
					? await submitImmediate(replacementEmployeeId, value.acknowledgeUnassignedDuties)
					: await submitScheduled(value, replacementEmployeeId);
			if (result.success) {
				requestIdentity.complete();
				props.onCompleted();
				return;
			}
			// Entered values stay in place; the server's guidance explains what to fix.
			setSubmitError(
				result.error ||
					t("settings.employees.offboarding.saveFailed", "The departure could not be saved."),
			);
			requestAnimationFrame(() => errorRef.current?.focus());
		},
	});

	function submitScheduled(value: DepartureFormValues, replacementEmployeeId: string | null) {
		const intent = {
			employeeId: props.employeeId,
			expectedRevision: props.departure?.revision ?? null,
			lastWorkingDay: value.lastWorkingDay,
			replacementEmployeeId,
			acknowledgeUnassignedDuties: value.acknowledgeUnassignedDuties,
		};
		return props.scheduleDeparture({
			...intent,
			requestId: requestIdentity.forPayload({ command: "schedule", ...intent }),
		});
	}

	function submitImmediate(replacementEmployeeId: string | null, acknowledge: boolean) {
		const intent = {
			employeeId: props.employeeId,
			replacementEmployeeId,
			acknowledgeUnassignedDuties: acknowledge,
		};
		return props.offboardNow({
			...intent,
			requestId: requestIdentity.forPayload({ command: "offboard_now", ...intent }),
		});
	}

	return (
		<form
			aria-label={t("settings.employees.offboarding.formLabel", "Employee departure")}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			{submitError && (
				<Alert variant="destructive" ref={errorRef} tabIndex={-1} role="alert">
					<IconAlertTriangle aria-hidden="true" />
					<AlertDescription>{submitError}</AlertDescription>
				</Alert>
			)}

			<form.Field name="mode">
				{(field) => (
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">
							{t("settings.employees.offboarding.mode", "When does the employee leave?")}
						</legend>
						<RadioGroup
							value={field.state.value}
							onValueChange={(value) => field.handleChange(value as DepartureFormValues["mode"])}
						>
							{props.canSchedule && (
								<div className="flex items-center gap-2">
									<RadioGroupItem value="scheduled" id="departure-mode-scheduled" />
									<Label htmlFor="departure-mode-scheduled">
										{t("settings.employees.offboarding.schedule", "Schedule departure")}
									</Label>
								</div>
							)}
							{props.canOffboardNow && (
								<div className="flex items-center gap-2">
									<RadioGroupItem value="immediate" id="departure-mode-immediate" />
									<Label htmlFor="departure-mode-immediate">
										{t("settings.employees.offboarding.offboardNow", "Offboard now")}
									</Label>
								</div>
							)}
						</RadioGroup>
					</fieldset>
				)}
			</form.Field>

			<form.Subscribe selector={(state) => state.values.mode}>
				{(mode) =>
					mode === "scheduled" ? (
						<form.Field
							name="lastWorkingDay"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: t(
												"settings.employees.offboarding.lastWorkingDayRequired",
												"Choose the last working day.",
											),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.employees.offboarding.lastWorkingDay", "Last working day")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<DatePicker
											name="lastWorkingDay"
											value={field.state.value}
											onChange={field.handleChange}
											onBlur={field.handleBlur}
											required
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					) : (
						<Alert role="note">
							<IconAlertTriangle aria-hidden="true" />
							<AlertDescription>
								{t(
									"settings.employees.offboarding.offboardNowDescription",
									"Access and paid-seat usage end immediately, and a running timer is closed now.",
								)}
							</AlertDescription>
						</Alert>
					)
				}
			</form.Subscribe>

			<form.Subscribe
				selector={(state) => ({
					mode: state.values.mode,
					lastWorkingDay: state.values.lastWorkingDay,
				})}
			>
				{({ mode, lastWorkingDay }) => (
					<DeparturePreviewFields
						form={form}
						organizationId={props.organizationId}
						employeeId={props.employeeId}
						lastWorkingDay={mode === "immediate" ? null : lastWorkingDay || null}
						enabled={mode === "immediate" || Boolean(lastWorkingDay)}
						locale={locale}
					/>
				)}
			</form.Subscribe>

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={props.onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
				<form.Subscribe
					selector={(state) => [state.canSubmit, state.isSubmitting, state.values.mode] as const}
				>
					{([canSubmit, isSubmitting, mode]) => (
						<Button
							type="submit"
							variant={mode === "immediate" ? "destructive" : "default"}
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{isSubmitting
								? t("settings.employees.offboarding.saving", "Saving…")
								: mode === "immediate"
									? t("settings.employees.offboarding.offboardNow", "Offboard now")
									: props.departure
										? t("settings.employees.offboarding.saveSchedule", "Save departure")
										: t("settings.employees.offboarding.schedule", "Schedule departure")}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}

type Sync = FormValidateOrFn<DepartureFormValues> | undefined;
type Async = FormAsyncValidateOrFn<DepartureFormValues> | undefined;
type DepartureFormApi = ReactFormExtendedApi<
	DepartureFormValues,
	Sync,
	Sync,
	Async,
	Sync,
	Async,
	Sync,
	Async,
	Sync,
	Async,
	Async,
	unknown
>;

/** Server preview: exact cutoff in the organization zone, replacements and exceptions. */
function DeparturePreviewFields({
	form,
	organizationId,
	employeeId,
	lastWorkingDay,
	enabled,
	locale,
}: {
	form: DepartureFormApi;
	organizationId: string;
	employeeId: string;
	lastWorkingDay: string | null;
	enabled: boolean;
	locale: string;
}) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	const preview = useDeparturePreview({ organizationId, employeeId, lastWorkingDay, enabled });
	const data = preview.data;
	const hasDuties = (data?.pendingDutyCount ?? 0) > 0;

	return (
		<div className="space-y-4" aria-live="polite">
			{preview.isFetching && (
				<p className="text-sm text-muted-foreground">
					{t("settings.employees.offboarding.previewLoading", "Calculating the cutoff…")}
				</p>
			)}
			{preview.error && (
				<p className="text-sm text-destructive" role="alert">
					{preview.error.message}
				</p>
			)}
			{data && (
				<p className="text-sm" data-testid="departure-cutoff">
					{t(
						"settings.employees.offboarding.scheduledDescription",
						"Access and paid-seat usage end at {cutoff} ({timezone}).",
						{
							cutoff: formatDepartureCutoff(data.cutoff, data.timezone, locale),
							timezone: data.timezone,
						},
					)}
				</p>
			)}
			{data && data.exceptions.length > 0 && (
				<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
					{data.exceptions.map((exception) => (
						<li key={exception}>{labels.exception(exception)}</li>
					))}
				</ul>
			)}

			<form.Field name="replacementEmployeeId">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.employees.offboarding.replacement", "Replacement for approvals")}
						</TFormLabel>
						<Select value={field.state.value} onValueChange={field.handleChange}>
							<TFormControl hasError={fieldHasError(field)}>
								<SelectTrigger className="w-full" onBlur={field.handleBlur}>
									<SelectValue />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value={NO_REPLACEMENT}>
									{t("settings.employees.offboarding.noReplacement", "No replacement")}
								</SelectItem>
								{data?.replacementOptions.map((option) => (
									<SelectItem key={option.employeeId} value={option.employeeId}>
										{option.name || option.employeeId}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TFormDescription>
							{t(
								"settings.employees.offboarding.replacementHelp",
								"Open approval duties move to this person when the departure takes effect.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<form.Subscribe selector={(state) => state.values.replacementEmployeeId}>
				{(replacement) =>
					hasDuties && replacement === NO_REPLACEMENT ? (
						<form.Field
							name="acknowledgeUnassignedDuties"
							validators={{
								onSubmit: ({ value }) =>
									value
										? undefined
										: t(
												"settings.employees.offboarding.acknowledgeRequired",
												"Choose a replacement or confirm admins will resolve the open duties.",
											),
							}}
						>
							{(field) => (
								<TFormItem>
									<div className="flex items-start gap-2">
										<Checkbox
											id="acknowledge-unassigned-duties"
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<Label htmlFor="acknowledge-unassigned-duties" className="leading-snug">
											{t(
												"settings.employees.offboarding.acknowledgeDuties",
												"Admins will resolve the {count} open approval duties.",
												{ count: data?.pendingDutyCount ?? 0 },
											)}
										</Label>
									</div>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					) : null
				}
			</form.Subscribe>
		</div>
	);
}
