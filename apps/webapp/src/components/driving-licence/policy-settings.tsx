"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import {
	enrollDrivingLicenceEmployeeAction,
	saveDrivingLicencePolicyAction,
} from "@/lib/organization/driving-licence/policy-actions";
export interface DrivingLicenceSettingsData {
	policy: DrivingLicencePolicyInput | null;
	employees: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	}[];
	participants: { employeeId: string }[];
}
export function DrivingLicenceSettings({
	data,
}: {
	data: DrivingLicenceSettingsData;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [enabled, setEnabled] = useState(data.policy?.enabled ?? false);
	const form = useForm({
		defaultValues: {
			enabled: data.policy?.enabled ?? false,
			intervalMonths: data.policy?.intervalMonths ?? 6,
			timezone: data.policy?.timezone ?? "Europe/Berlin",
			reminderLeadDays: (data.policy?.reminderLeadDays ?? [30, 7]).join(", "),
			retentionMonths: data.policy?.retentionMonths?.toString() ?? "",
			retentionJustification: data.policy?.retentionJustification ?? "",
		},
		onSubmit: async ({ value }) => {
			setMessage("");
			setError("");
			const result = await saveDrivingLicencePolicyAction({
				...value,
				reminderLeadDays: value.reminderLeadDays
					.split(",")
					.map((s) => Number(s.trim())),
				retentionMonths: value.retentionMonths.trim()
					? Number(value.retentionMonths)
					: null,
				retentionJustification: value.retentionJustification.trim() || null,
			});
			if (!result.success) {
				setError(
					result.error === "timezone_fixed"
						? t(
								"drivingLicence.zoneFixedError",
								"The calendar timezone is fixed. Existing deadlines must keep their original meaning.",
							)
						: t(
								"drivingLicence.saveError",
								"The policy could not be saved. Check the interval, timezone, reminders and justified retention period.",
							),
				);
				return;
			}
			setEnabled(value.enabled);
			setMessage(t("drivingLicence.saved", "Policy saved"));
			router.refresh();
		},
	});
	return (
		<div className="space-y-8">
			<section
				aria-labelledby="driving-policy-title"
				className="rounded-lg border bg-card p-5 sm:p-6"
			>
				<h2 id="driving-policy-title" className="text-lg font-semibold">
					{t("drivingLicence.policyTitle", "Organization policy")}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					{t(
						"drivingLicence.policyIntro",
						"Germany-first original licence checks. Choose the routine interval and justify a finite evidence retention period before activation.",
					)}
				</p>
				<form
					className="mt-6 space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="enabled">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"drivingLicence.activate",
										"Activate driving licence control",
									)}
								</TFormLabel>
								<TFormControl>
									<input
										type="checkbox"
										aria-label={t(
											"drivingLicence.activate",
											"Activate driving licence control",
										)}
										name={field.name}
										className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
										checked={field.state.value}
										onChange={(event) =>
											field.handleChange(event.target.checked)
										}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"drivingLicence.activationHelp",
										"Enrollment does not grant driving authorization. An authorized verifier must first check the original licence.",
									)}
								</TFormDescription>
							</TFormItem>
						)}
					</form.Field>
					<div className="grid gap-5 sm:grid-cols-2">
						<form.Field name="intervalMonths">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t(
											"drivingLicence.interval",
											"Routine check interval (months)",
										)}
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
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(Number(event.target.value))
											}
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
									<TFormLabel>
										{t("drivingLicence.timezone", "Fixed calendar timezone")}
									</TFormLabel>
									<TFormControl>
										<Input
											name={field.name}
											autoComplete="off"
											required
											maxLength={100}
											value={field.state.value}
											readOnly={data.policy !== null}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
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
					<form.Field name="reminderLeadDays">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t("drivingLicence.reminders", "Reminder lead days")}
								</TFormLabel>
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
					<div className="grid gap-5 sm:grid-cols-2">
						<form.Field name="retentionMonths">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("drivingLicence.retention", "Retention period (months)")}
									</TFormLabel>
									<TFormControl>
										<Input
											name={field.name}
											autoComplete="off"
											type="number"
											min={1}
											max={120}
											step={1}
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"drivingLicence.retentionHelp",
											"Required for activation: 1–120 months after evidence no longer supports any active class authorization. Choose a period appropriate to your organization.",
										)}
									</TFormDescription>
								</TFormItem>
							)}
						</form.Field>
						<form.Field name="retentionJustification">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t(
											"drivingLicence.justification",
											"Retention justification",
										)}
									</TFormLabel>
									<TFormControl>
										<Textarea
											name={field.name}
											autoComplete="off"
											maxLength={2000}
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
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
			</section>
			<p role="status" className="text-sm" aria-live="polite">
				{message}
			</p>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<DriverEnrollment data={data} enabled={enabled} onError={setError} />
		</div>
	);
}

function DriverEnrollment({
	data,
	enabled,
	onError,
}: {
	data: DrivingLicenceSettingsData;
	enabled: boolean;
	onError: (message: string) => void;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [enrolled, setEnrolled] = useState(
		() => new Set(data.participants.map((p) => p.employeeId)),
	);
	const [isEnrolling, startEnrollment] = useTransition();
	function enroll(employeeId: string) {
		startEnrollment(async () => {
			onError("");
			const result = await enrollDrivingLicenceEmployeeAction({ employeeId });
			if (!result.success) {
				onError(
					t(
						"drivingLicence.enrollError",
						"The employee could not be enrolled. Activate the policy first and check your access.",
					),
				);
				return;
			}
			setEnrolled((previous) => new Set([...previous, employeeId]));
			router.refresh();
		});
	}
	return (
		<section
			aria-labelledby="driving-enrollment-title"
			className="rounded-lg border bg-card p-5 sm:p-6"
		>
			<h2 id="driving-enrollment-title" className="text-lg font-semibold">
				{t("drivingLicence.enrollmentTitle", "Intended drivers")}
			</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				{t(
					"drivingLicence.enrollmentHelp",
					"Enroll employees who are intended to drive. Vehicle assignments and previous vehicle use never create authorization.",
				)}
			</p>
			{data.employees.length === 0 ? (
				<p className="mt-5 text-sm text-muted-foreground">
					{t(
						"drivingLicence.noEmployees",
						"There are no active employees to enroll.",
					)}
				</p>
			) : (
				<ul className="mt-5 divide-y">
					{data.employees.map((employee) => {
						const name =
							[employee.firstName, employee.lastName]
								.filter(Boolean)
								.join(" ") || t("drivingLicence.unnamedEmployee", "Employee");
						return (
							<li
								key={employee.id}
								className="flex flex-wrap items-center justify-between gap-3 py-4 [content-visibility:auto] [contain-intrinsic-size:auto_64px]"
							>
								<span className="min-w-0 break-words font-medium">{name}</span>
								{enrolled.has(employee.id) ? (
									<span className="rounded-md bg-muted px-3 py-1 text-sm">
										{t(
											"drivingLicence.notChecked",
											"Not yet checked — no driving authorization",
										)}
									</span>
								) : (
									<Button
										type="button"
										variant="outline"
										disabled={!enabled || isEnrolling}
										aria-label={t(
											"drivingLicence.enrollName",
											"Enroll {name}",
											{ name },
										)}
										onClick={() => enroll(employee.id)}
									>
										{t("drivingLicence.enroll", "Enroll")}
									</Button>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
