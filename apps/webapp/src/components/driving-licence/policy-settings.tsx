"use client";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import type { DrivingLicencePolicyInput } from "@/lib/organization/driving-licence/policy";
import { saveDrivingLicencePolicyAction } from "@/lib/organization/driving-licence/policy-actions";
import { DrivingLicenceIntervalSettings } from "./interval-settings";
export interface DrivingLicenceSettingsData {
	policy: DrivingLicencePolicyInput | null;
}

type Translate = ReturnType<typeof useTranslate>["t"];

/** The message for a refused policy save. */
function policySaveError(t: Translate, error: string | undefined) {
	if (error === "retention_required") {
		return t(
			"drivingLicence.retentionRequiredError",
			"Keep a finite, justified retention period when disabling licence control. Existing evidence remains subject to cleanup.",
		);
	}
	if (error === "timezone_fixed") {
		return t(
			"drivingLicence.zoneFixedError",
			"The calendar timezone is fixed. Existing deadlines must keep their original meaning.",
		);
	}
	return t(
		"drivingLicence.saveError",
		"The policy could not be saved. Check the interval, timezone, reminders and justified retention period.",
	);
}

/**
 * The organization policy form; a save reports through `feedback`. It never switches
 * control on or off: the Features card switch is the only activation (#1421).
 */
function usePolicyForm(
	data: DrivingLicenceSettingsData,
	feedback: {
		setMessage: (message: string) => void;
		setError: (error: string) => void;
	},
) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const policy = data.policy;
	return useForm({
		defaultValues: {
			intervalMonths: policy?.intervalMonths ?? 6,
			timezone: policy?.timezone ?? "Europe/Berlin",
			reminderLeadDays: (policy?.reminderLeadDays ?? [30, 7]).join(", "),
			retentionMonths: policy?.retentionMonths?.toString() ?? "",
			retentionJustification: policy?.retentionJustification ?? "",
		},
		onSubmit: async ({ value }) => {
			feedback.setMessage("");
			feedback.setError("");
			const result = await saveDrivingLicencePolicyAction({
				...value,
				intervalMonths: policy?.intervalMonths ?? value.intervalMonths,
				reminderLeadDays: value.reminderLeadDays.split(",").map((s) => Number(s.trim())),
				retentionMonths: value.retentionMonths.trim() ? Number(value.retentionMonths) : null,
				retentionJustification: value.retentionJustification.trim() || null,
			});
			if (!result.success) {
				feedback.setError(policySaveError(t, result.error));
				return;
			}
			feedback.setMessage(t("drivingLicence.saved", "Policy saved"));
			void queryClient.invalidateQueries({
				queryKey: ["driving-authorization-status"],
			});
			router.refresh();
		},
	});
}

type PolicyForm = ReturnType<typeof usePolicyForm>;

export function DrivingLicenceSettings({ data }: { data: DrivingLicenceSettingsData }) {
	const { t } = useTranslate();
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const form = usePolicyForm(data, { setMessage, setError });
	return (
		<div className="space-y-8">
			<section
				aria-labelledby="driving-policy-title"
				className="rounded-lg border bg-card p-5 sm:p-6"
			>
				<h2 id="driving-policy-title" className="text-lg font-semibold">
					{t("drivingLicence.policyTitle", "Organization policy")}
				</h2>
				{data.policy ? (
					<>
						<p className="mt-1 text-sm text-muted-foreground">
							{t(
								"drivingLicence.policyIntro",
								"Germany-first original licence checks. Choose the routine interval and justify a finite evidence retention period before activation.",
							)}
						</p>
						{/* TanStack Form owns the submission lifecycle; see .react-doctor/false-positives.md. */}
						{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
						<form
							className="mt-6 space-y-5"
							onSubmit={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void form.handleSubmit();
							}}
						>
							<PolicyScheduleFields form={form} policy={data.policy} t={t} />
							<PolicyReminderField form={form} t={t} />
							<PolicyRetentionFields form={form} t={t} />
							<form.Subscribe selector={(state) => state.isSubmitting}>
								{(submitting) => (
									<Button type="submit" disabled={submitting}>
										{submitting
											? t("drivingLicence.saving", "Saving…")
											: t("drivingLicence.save", "Save policy")}
									</Button>
								)}
							</form.Subscribe>
						</form>
					</>
				) : (
					<p className="mt-1 text-sm text-muted-foreground">
						{t(
							"drivingLicence.switchOnFirst",
							"Switch on driving licence control on the Features card in Organization settings. Setting it up there saves the first policy.",
						)}
					</p>
				)}
				{data.policy ? (
					<DrivingLicenceIntervalSettings
						key={data.policy.intervalMonths}
						intervalMonths={data.policy.intervalMonths}
					/>
				) : null}
			</section>
			<p role="status" className="text-sm" aria-live="polite">
				{message}
			</p>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** The routine interval and the calendar timezone; both are fixed once a policy is saved. */
function PolicyScheduleFields({
	form,
	policy,
	t,
}: {
	form: PolicyForm;
	policy: DrivingLicencePolicyInput | null;
	t: Translate;
}) {
	return (
		<div className="grid gap-5 sm:grid-cols-2">
			<form.Field name="intervalMonths">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("drivingLicence.interval", "Routine check interval (months)")}
						</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								autoComplete="off"
								type="number"
								min={1}
								max={120}
								step={1}
								required
								value={policy?.intervalMonths ?? field.state.value}
								readOnly={policy !== null}
								onChange={(event) => field.handleChange(Number(event.target.value))}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"drivingLicence.intervalHelp",
								"Each checked class uses its own last successful check as the routine-check anchor.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="timezone">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("drivingLicence.timezone", "Fixed calendar timezone")}</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								autoComplete="off"
								required
								maxLength={100}
								value={field.state.value}
								readOnly={policy !== null}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								spellCheck={false}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"drivingLicence.zoneHelp",
								"Date-only limits include the whole shown day in this timezone. It is fixed when first saved; the viewer's timezone never changes a deadline.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
		</div>
	);
}

function PolicyReminderField({ form, t }: { form: PolicyForm; t: Translate }) {
	return (
		<form.Field name="reminderLeadDays">
			{(field) => (
				<TFormItem>
					<TFormLabel>{t("drivingLicence.reminders", "Reminder lead days")}</TFormLabel>
					<TFormControl>
						<Input
							name={field.name}
							autoComplete="off"
							required
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							placeholder="30, 7"
						/>
					</TFormControl>
					<TFormDescription>
						{t(
							"drivingLicence.remindersHelp",
							"Comma-separated whole days before a deadline, from 0 to 365. The initial suggestions are 30 and 7 days.",
						)}
					</TFormDescription>
				</TFormItem>
			)}
		</form.Field>
	);
}

/** The finite evidence retention period and its justification. */
function PolicyRetentionFields({ form, t }: { form: PolicyForm; t: Translate }) {
	return (
		<div className="grid gap-5 sm:grid-cols-2">
			<form.Field name="retentionMonths">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("drivingLicence.retention", "Retention period (months)")}</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								autoComplete="off"
								type="number"
								min={1}
								max={120}
								step={1}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"drivingLicence.retentionHelp",
								"Required for activation: 1–120 months after evidence no longer supports any active class authorization. Keep a justified finite period when disabling licence control; cleanup continues.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="retentionJustification">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("drivingLicence.justification", "Retention justification")}</TFormLabel>
						<TFormControl>
							<Textarea
								name={field.name}
								autoComplete="off"
								maxLength={2000}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"drivingLicence.justificationHelp",
								"Explain why this finite period is necessary (at least 10 characters). Do not include private or medical details.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
		</div>
	);
}
