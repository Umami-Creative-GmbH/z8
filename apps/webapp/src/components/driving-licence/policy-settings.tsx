"use client";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { queryKeys } from "@/lib/query";
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
 * The organization policy form; a save reports in a toast. It never switches control on or
 * off: the Features card switch is the only activation (#1421). The interval and timezone
 * are saved as they are; the interval changes only through its impact preview.
 */
function usePolicyForm(policy: DrivingLicencePolicyInput) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	return useForm({
		defaultValues: {
			reminderLeadDays: policy.reminderLeadDays.join(", "),
			retentionMonths: policy.retentionMonths?.toString() ?? "",
			retentionJustification: policy.retentionJustification ?? "",
		},
		onSubmit: async ({ value }) => {
			const result = await saveDrivingLicencePolicyAction({
				intervalMonths: policy.intervalMonths,
				timezone: policy.timezone,
				reminderLeadDays: value.reminderLeadDays.split(",").map((s) => Number(s.trim())),
				retentionMonths: value.retentionMonths.trim() ? Number(value.retentionMonths) : null,
				retentionJustification: value.retentionJustification.trim() || null,
			}).catch(() => null);
			if (!result?.success) {
				toast.error(policySaveError(t, result?.error));
				return;
			}
			toast.success(t("drivingLicence.saved", "Policy saved"));
			void queryClient.invalidateQueries({
				queryKey: queryKeys.drivingLicence.status,
			});
			router.refresh();
		},
	});
}

type PolicyForm = ReturnType<typeof usePolicyForm>;

/** The Policy tab (#1427): the interval with its impact preview, reminders and retention. */
export function DrivingLicenceSettings({ data }: { data: DrivingLicenceSettingsData }) {
	const { t } = useTranslate();
	if (!data.policy)
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("drivingLicence.policyTitle", "Organization policy")}</CardTitle>
					<CardDescription>
						{t(
							"drivingLicence.switchOnFirst",
							"Switch on driving licence control on the Features card in Organization settings. Setting it up there saves the first policy.",
						)}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	return (
		<div className="space-y-6">
			<PolicyScheduleCard policy={data.policy} />
			<PolicyFormCard policy={data.policy} />
		</div>
	);
}

/** The routine interval and the deadline timezone, both shown read-only, then the interval change. */
function PolicyScheduleCard({ policy }: { policy: DrivingLicencePolicyInput }) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("drivingLicence.settingsTabs.scheduleTitle", "Check schedule")}</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.intervalHelp",
						"Each checked class uses its own last successful check as the routine-check anchor.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<dl className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-1">
						<dt className="text-sm text-muted-foreground">
							{t("drivingLicence.interval", "Routine check interval (months)")}
						</dt>
						<dd className="font-medium tabular-nums">{policy.intervalMonths}</dd>
					</div>
					<div className="space-y-1">
						<dt className="text-sm text-muted-foreground">
							{t("drivingLicence.settingsTabs.deadlineTimezone", "Deadline timezone")}
						</dt>
						<dd className="font-medium break-words">{policy.timezone}</dd>
					</div>
				</dl>
				<p className="text-sm text-muted-foreground">
					{t(
						"drivingLicence.zoneHelp",
						"Date-only limits include the whole shown day in this timezone. It is fixed when first saved; the viewer's timezone never changes a deadline.",
					)}
				</p>
				<div className="border-t pt-6">
					<DrivingLicenceIntervalSettings
						key={policy.intervalMonths}
						intervalMonths={policy.intervalMonths}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function PolicyFormCard({ policy }: { policy: DrivingLicencePolicyInput }) {
	const { t } = useTranslate();
	const form = usePolicyForm(policy);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("drivingLicence.settingsTabs.remindersTitle", "Reminders and retention")}
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.settingsTabs.remindersDescription",
						"When reminders go out before a deadline, and how long evidence is kept once it no longer supports an authorization.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{/* TanStack Form owns the submission lifecycle; see .react-doctor/false-positives.md. */}
				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
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
			</CardContent>
		</Card>
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
