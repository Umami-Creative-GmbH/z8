"use client";
import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
	commitEmploymentDateCorrectionAction,
	previewEmploymentDateCorrectionAction,
} from "@/app/[locale]/(app)/settings/employees/employment-date-actions";
import { OrganizationTrackingImpact } from "@/components/organization/organization-tracking-impact";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EmploymentDateCorrectionImpact } from "@/lib/employee-lifecycle/employment-date-correction-types";
import { Link } from "@/navigation";
export function EmploymentDateCorrectionCard({
	employeeId,
	employmentStartDate,
	onSaved,
}: {
	employeeId: string;
	employmentStartDate: string | null;
	onSaved: () => unknown;
}) {
	const { t } = useTranslate();
	const id = useId();
	const [review, setReview] = useState<EmploymentDateCorrectionImpact | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [activationNeeded, setActivationNeeded] = useState(false);
	const form = useForm({
		defaultValues: { employmentStartDate: employmentStartDate ?? "", reason: "" },
		onSubmit: async ({ value }) => {
			setBusy(true);
			setError(null);
			setReview(null);
			setSaved(null);
			setActivationNeeded(false);
			try {
				const result = await previewEmploymentDateCorrectionAction({
					employeeId,
					employmentStartDate: value.employmentStartDate,
				});
				if (result.success) setReview(result.data);
				else {
					setError(result.error);
					setActivationNeeded(result.code === "blocked");
				}
			} catch {
				setError(
					t(
						"settings.employmentCorrection.previewFailed",
						"Could not prepare this correction. Try again.",
					),
				);
			}
			setBusy(false);
		},
	});
	const save = async () => {
		if (!review || busy || review.blockers.length || review.employmentBlockers.length) return;
		const reason = form.state.values.reason.trim();
		if (!reason) {
			setError(
				t("settings.employmentCorrection.reasonRequired", "Enter a reason for the correction."),
			);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const result = await commitEmploymentDateCorrectionAction({
				employeeId,
				employmentStartDate: review.employmentStartDate,
				fingerprint: review.fingerprint,
				reason,
			});
			if (result.success) {
				setSaved(
					result.data.refreshPending
						? t(
								"settings.employmentCorrection.savedPending",
								"Employment date saved. Work balances are being refreshed.",
							)
						: t(
								"settings.employmentCorrection.saved",
								"Employment date corrected and balances updated.",
							),
				);
				setReview(null);
				await onSaved();
			} else {
				setError(result.error);
				setReview(null);
			}
		} catch {
			setError(
				t(
					"settings.employmentCorrection.saveFailed",
					"Could not save this correction. Generate a new preview and try again.",
				),
			);
			setReview(null);
		}
		setBusy(false);
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.employmentCorrection.title", "Correct actual employment start")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.employmentCorrection.description",
						"Enter the employee’s true original joining date from their employment records. Review vacation and work balances before saving. Recorded departures, later rehires and confirmed terms remain in place.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<form
					action={() => {
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field
						name="employmentStartDate"
						validators={{
							onChange: ({ value }) => {
								try {
									Temporal.PlainDate.from(value);
									return undefined;
								} catch {
									return t(
										"settings.employmentCorrection.invalidDate",
										"Enter a valid calendar date.",
									);
								}
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={`${id}-date`}>
									{t("settings.employmentCorrection.actualStartLabel", "Actual employment start")}
								</Label>
								<Input
									id={`${id}-date`}
									name="employmentStartDate"
									type="date"
									required
									value={field.state.value}
									disabled={busy}
									onChange={(e) => {
										field.handleChange(e.target.value);
										setReview(null);
									}}
									onBlur={field.handleBlur}
									aria-describedby={`${id}-date-help`}
									aria-invalid={field.state.meta.errors.length > 0}
								/>
								<p id={`${id}-date-help`} className="text-sm text-muted-foreground">
									{t(
										"settings.employmentCorrection.actualStartHelp",
										"This date determines employment-based vacation allowance. Time tracking has a separate effective start date.",
									)}
								</p>
							</div>
						)}
					</form.Field>
					<Button type="submit" disabled={busy}>
						{busy ? (
							<IconLoader2
								className="mr-2 size-4 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
						) : null}
						{t("settings.employmentCorrection.preview", "Review employment correction")}
					</Button>
				</form>
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
				{activationNeeded ? (
					<Link href="/settings/organizations" className="text-sm underline">
						{t(
							"settings.employmentCorrection.activateFirst",
							"Review tracking activation in organization settings",
						)}
					</Link>
				) : null}
				{saved ? (
					<p role="status" className="text-sm">
						{saved}
					</p>
				) : null}
				{review ? (
					<section
						className="space-y-4"
						aria-label={t(
							"settings.employmentCorrection.reviewTitle",
							"Employment correction review",
						)}
					>
						<p className="text-sm">
							{t("settings.employmentCorrection.dateChange", "Actual employment start:")}{" "}
							{review.previousEmploymentStartDate ??
								t("settings.employmentCorrection.unknown", "Not recorded")}{" "}
							→ {review.employmentStartDate}
						</p>
						{review.vacation.map((row) => (
							<div key={row.year} className="rounded-md border p-3 text-sm">
								<h3 className="font-medium">
									{row.year} · {t("settings.employmentCorrection.vacation", "Vacation (days)")}
								</h3>
								<dl className="grid gap-2 sm:grid-cols-3">
									<div>
										<dt>{t("settings.employmentCorrection.allowance", "Allowance")}</dt>
										<dd>
											{row.before?.allowanceDays ?? "—"} → {row.after?.allowanceDays ?? "—"}
										</dd>
									</div>
									<div>
										<dt>{t("settings.employmentCorrection.total", "Total before usage")}</dt>
										<dd>
											{row.before?.totalDays ?? "—"} → {row.after?.totalDays ?? "—"}
										</dd>
									</div>
									<div>
										<dt>{t("settings.employmentCorrection.remaining", "Remaining")}</dt>
										<dd>
											{row.before?.remainingDays ?? "—"} → {row.after?.remainingDays ?? "—"}
										</dd>
									</div>
								</dl>
							</div>
						))}
						{review.employmentBlockers.length ? (
							<ul role="alert" className="list-disc pl-5 text-sm text-destructive">
								{review.employmentBlockers.map((item) => (
									<li key={item.code}>{item.message}</li>
								))}
							</ul>
						) : null}
						<OrganizationTrackingImpact
							impact={{
								...review,
								employees: review.employees.map((row) => ({ ...row, vacation: [] })),
							}}
							description={t(
								"settings.employmentCorrection.workReview",
								"Review required time and accumulated work balances below. Organization tracking dates, employee exceptions and opening-balance checkpoints stay unchanged.",
							)}
						/>
						<form.Field name="reason">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={`${id}-reason`}>
										{t("settings.employmentCorrection.reason", "Reason for correction")}
									</Label>
									<Textarea
										id={`${id}-reason`}
										value={field.state.value}
										maxLength={1000}
										disabled={busy}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>
						<Button
							type="button"
							onClick={() => void save()}
							disabled={busy || review.blockers.length > 0 || review.employmentBlockers.length > 0}
						>
							{t("settings.employmentCorrection.save", "Save reviewed employment date")}
						</Button>
					</section>
				) : null}
			</CardContent>
		</Card>
	);
}
