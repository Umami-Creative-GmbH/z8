"use client";
import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
	commitEmployeeTrackingDateAction,
	getEmployeeTrackingDateAction,
	previewEmployeeTrackingDateAction,
} from "@/app/[locale]/(app)/settings/employees/employee-tracking-date-actions";
import { OrganizationTrackingImpact } from "@/components/organization/organization-tracking-impact";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeeTrackingDateSettings } from "@/lib/time-tracking/employee-tracking-date";
import type { TrackingDateImpact } from "@/lib/time-tracking/tracking-date-review-types";
import { EMPLOYEE_WORK_BALANCE_QUERY_KEY } from "@/components/settings/work-balance/use-employee-work-balance";
import { useRouter } from "@/navigation";
async function withBusyState(setBusy: (busy: boolean) => void, action: () => Promise<void>) {
	setBusy(true);
	try {
		await action();
	} finally {
		setBusy(false);
	}
}

const queryKey = (employeeId: string) => ["employee-tracking-date", employeeId];
export function EmployeeTrackingDateCard({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: queryKey(employeeId),
		queryFn: async () => {
			const result = await getEmployeeTrackingDateAction(employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.employees.tracking.title", "Employee tracking start")}</CardTitle>
				<CardDescription>
					{t(
						"settings.employees.tracking.description",
						"Required time and accumulated work balances start on the effective tracking date. Actual employment dates and vacation allowances stay unchanged.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{query.isPending ? (
					<output aria-label={t("settings.employees.tracking.loading", "Loading tracking dates")}>
						<IconLoader2
							className="size-5 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					</output>
				) : query.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{t("settings.employees.tracking.load-error", "Could not load employee tracking dates.")}
					</p>
				) : (
					<EmployeeTrackingDateDetails employeeId={employeeId} settings={query.data} />
				)}
			</CardContent>
		</Card>
	);
}
function EmployeeTrackingDateDetails({
	employeeId,
	settings,
}: {
	employeeId: string;
	settings: EmployeeTrackingDateSettings & { canManage: boolean };
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const format = (day: string | null) =>
		day ? Temporal.PlainDate.from(day).toLocaleString(locale) : null;
	const entries = [
		[
			t("settings.employees.tracking.employment", "Actual employment start"),
			format(settings.employmentStartDate) ??
				t("settings.employees.tracking.unknown-employment", "Not recorded"),
		],
		[
			t("settings.employees.tracking.organization", "Organization tracking date"),
			format(settings.organizationTrackingStartDate) ??
				t("settings.employees.tracking.not-active", "Not activated"),
		],
		[
			t("settings.employees.tracking.exception", "Employee exception"),
			format(settings.employeeTrackingStartDate) ??
				t("settings.employees.tracking.inherited", "None — inherits the organization default"),
		],
		[
			t("settings.employees.tracking.effective", "Effective tracking start"),
			format(settings.effectiveTrackingStartDate) ??
				t("settings.employees.tracking.legacy", "Existing calculation rules"),
		],
	];
	return (
		<>
			<dl className="grid gap-4 text-sm sm:grid-cols-2">
				{entries.map(([label, value]) => (
					<div key={label}>
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="mt-1 font-medium">{value}</dd>
					</div>
				))}
			</dl>
			{!settings.active ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.employees.tracking.activate-first",
						"Activate explicit time tracking in organization settings before setting employee exceptions.",
					)}
				</p>
			) : (
				<p className="text-sm text-muted-foreground">
					{settings.employeeTrackingStartDate
						? t(
								"settings.employees.tracking.overridden-basis",
								"This employee has a later rollout date. The effective date also respects their actual employment start.",
							)
						: t(
								"settings.employees.tracking.inherited-basis",
								"This employee inherits the later of the organization tracking date and their actual employment start.",
							)}
				</p>
			)}
			{settings.active && settings.canManage ? (
				<EmployeeTrackingDateForm employeeId={employeeId} settings={settings} />
			) : null}
		</>
	);
}
function EmployeeTrackingDateForm({
	employeeId,
	settings,
}: {
	employeeId: string;
	settings: EmployeeTrackingDateSettings;
}) {
	const { t } = useTranslate();
	const id = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [review, setReview] = useState<{ impact: TrackingDateImpact; date: string | null } | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const minimum = [settings.organizationTrackingStartDate, settings.employmentStartDate]
		.filter((day): day is string => !!day)
		.sort()
		.at(-1);
	const form = useForm({
		defaultValues: { trackingStartDate: settings.employeeTrackingStartDate ?? "", reason: "" },
		onSubmit: async ({ value }) =>
			withBusyState(setBusy, async () => {
				setError(null);
				setSaved(null);
				setReview(null);
				try {
					const date = value.trackingStartDate || null;
					const result = await previewEmployeeTrackingDateAction({
						employeeId,
						trackingStartDate: date,
					});
					if (result.success) setReview({ impact: result.data, date });
					else setError(result.error);
				} catch {
					setError(
						t(
							"settings.employees.tracking.preview-failed",
							"Could not generate the preview. Try again.",
						),
					);
				}
			}),
	});
	const commit = async () => {
		if (!review || busy || review.impact.blockers.length) return;
		const reason = form.state.values.reason.trim();
		if (!reason) {
			setError(t("settings.employees.tracking.reason-required", "Enter a reason before saving."));
			return;
		}
		await withBusyState(setBusy, async () => {
			setError(null);
			try {
				const result = await commitEmployeeTrackingDateAction({
					employeeId,
					trackingStartDate: review.date,
					fingerprint: review.impact.fingerprint,
					reason,
				});
				if (!result.success) {
					setError(result.error);
					setReview(null);
					return;
				}
				setSaved(
					result.data.refreshPending
						? t(
								"settings.employees.tracking.saved-pending",
								"Employee tracking date saved. Balances are being recalculated.",
							)
						: t(
								"settings.employees.tracking.saved",
								"Employee tracking date saved and balances updated.",
							),
				);
				setReview(null);
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: queryKey(employeeId) }),
					queryClient.invalidateQueries({
						queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId],
					}),
				]);
				router.refresh();
			} catch {
				setError(
					t(
						"settings.employees.tracking.save-failed",
						"Could not save the reviewed change. Generate a new preview and try again.",
					),
				);
				setReview(null);
			}
		});
	};
	return (
		<div className="space-y-4">
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				<form.Field
					name="trackingStartDate"
					validators={{ onChange: z.union([z.literal(""), z.iso.date()]) }}
				>
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={`${id}-date`}>
								{t("settings.employees.tracking.proposed", "Later employee tracking date")}
							</Label>
							<Input
								id={`${id}-date`}
								type="date"
								name="employeeTrackingStartDate"
								autoComplete="off"
								min={minimum}
								value={field.state.value}
								onBlur={field.handleBlur}
								disabled={busy}
								aria-describedby={`${id}-explanation`}
								aria-invalid={field.state.meta.errors.length > 0}
								onChange={(event) => {
									field.handleChange(event.target.value);
									setReview(null);
									setError(null);
									setSaved(null);
								}}
							/>
							<p id={`${id}-explanation`} className="text-sm text-muted-foreground">
								{t(
									"settings.employees.tracking.help",
									"Choose a later rollout date, or leave empty to use the organization default. Review the impact before saving; actual employment and vacation stay unchanged.",
								)}
							</p>
							{field.state.meta.errors.length ? (
								<p role="alert" className="text-sm text-destructive">
									{t("settings.employees.tracking.invalid-date", "Choose a valid calendar date.")}
								</p>
							) : null}
							<Button
								type="button"
								variant="ghost"
								disabled={busy}
								onClick={() => {
									field.handleChange("");
									setReview(null);
									setError(null);
									setSaved(null);
								}}
							>
								{t("settings.employees.tracking.use-default", "Use organization default")}
							</Button>
						</div>
					)}
				</form.Field>
				<Button type="submit" variant="outline" disabled={busy}>
					{busy ? (
						<IconLoader2
							aria-hidden="true"
							className="size-4 animate-spin motion-reduce:animate-none"
						/>
					) : null}
					{t("settings.employees.tracking.preview", "Preview employee tracking impact")}
				</Button>
			</form>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			{saved ? (
				<p role="status" className="text-sm">
					{saved}
				</p>
			) : null}
			{review ? (
				<div className="space-y-4">
					<OrganizationTrackingImpact impact={review.impact} />
					<form.Field name="reason" validators={{ onChange: z.string().max(1000) }}>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={`${id}-reason`}>
									{t("settings.employees.tracking.reason", "Reason for this change")}
								</Label>
								<Textarea
									id={`${id}-reason`}
									name="reason"
									autoComplete="off"
									required
									maxLength={1000}
									disabled={busy}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</div>
						)}
					</form.Field>
					<Button
						type="button"
						disabled={busy || review.impact.blockers.length > 0}
						onClick={() => void commit()}
					>
						{t("settings.employees.tracking.save", "Save reviewed employee date")}
					</Button>
				</div>
			) : null}
		</div>
	);
}
