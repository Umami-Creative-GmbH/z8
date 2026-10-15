"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
	commitOrganizationTrackingDateAction,
	previewOrganizationTrackingDateAction,
} from "@/app/[locale]/(app)/settings/organizations/tracking-date-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OrganizationTrackingSettings } from "@/lib/organization/tracking-settings";
import type { TrackingDateImpact } from "@/lib/time-tracking/tracking-date-review-types";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import { useRouter } from "@/navigation";
import { OrganizationTrackingImpact } from "./organization-tracking-impact";

export function OrganizationTrackingCard({
	settings,
	createdAt,
	timezone,
}: {
	settings: OrganizationTrackingSettings;
	createdAt: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	const id = useId();
	const [preview, setPreview] = useState<TrackingDateImpact | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const suggested = Temporal.Instant.from(createdAt)
		.toZonedDateTimeISO(isValidIanaTimeZone(timezone) ? timezone : "UTC")
		.toPlainDate()
		.toString();
	const form = useForm({
		defaultValues: { trackingStartDate: settings.trackingStartDate ?? suggested, reason: "" },
		onSubmit: async ({ value }) => {
			setBusy(true);
			setError(null);
			setSaved(null);
			setPreview(null);
			try {
				const result = await previewOrganizationTrackingDateAction({
					trackingStartDate: value.trackingStartDate,
				});
				if (result.success) setPreview(result.data);
				else setError(result.error);
			} catch {
				setError(
					t("organization.tracking.preview-failed", "Could not generate the preview. Try again."),
				);
			}
			setBusy(false);
		},
	});
	const commit = async () => {
		if (!preview || busy || preview.blockers.length) return;
		const reason = form.state.values.reason.trim();
		if (!reason) {
			setError(t("organization.tracking.reason-required", "Enter a reason before saving."));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const result = await commitOrganizationTrackingDateAction({
				trackingStartDate: preview.proposedDate,
				fingerprint: preview.fingerprint,
				reason,
			});
			if (!result.success) {
				setError(
					result.code === "stale_preview"
						? t(
								"organization.tracking.stale-preview",
								"The reviewed inputs changed. Generate a new preview before saving.",
							)
						: result.code === "blocked"
							? t(
									"organization.tracking.blocked-save",
									"Reopen the affected closed months and generate a new preview.",
								)
							: result.error,
				);
				setPreview(null);
				setBusy(false);
				return;
			}
			setSaved(
				result.data.refreshPending
					? t(
							"organization.tracking.saved-pending",
							"Tracking date saved. Work balances are being recalculated.",
						)
					: t("organization.tracking.saved", "Tracking date saved and balances updated."),
			);
			setPreview(null);
			router.refresh();
		} catch {
			setError(
				t(
					"organization.tracking.commit-failed",
					"Could not save the reviewed change. Generate a new preview and try again.",
				),
			);
			setPreview(null);
		}
		setBusy(false);
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.tracking.title", "Time tracking start")}</CardTitle>
				<CardDescription>
					{t(
						"organization.tracking.description",
						"This date controls required time and accumulated work balances. Employees’ actual employment dates determine their vacation allowance.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{settings.active && settings.trackingStartDate ? (
					<p className="text-sm">
						{t("organization.tracking.saved-date", "Current organization tracking date:")}{" "}
						<time dateTime={settings.trackingStartDate}>
							{Temporal.PlainDate.from(settings.trackingStartDate).toLocaleString(locale)}
						</time>
					</p>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.tracking.legacy",
							"Your current work-balance calculation is still in use. No time tracking start date has been activated.",
						)}
					</p>
				)}
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field name="trackingStartDate" validators={{ onChange: z.iso.date() }}>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={`${id}-date`}>
									{t("organization.tracking.start-date", "Time tracking start date")}
								</Label>
								<Input
									id={`${id}-date`}
									type="date"
									name="trackingStartDate"
									autoComplete="off"
									value={field.state.value}
									disabled={busy}
									onBlur={field.handleBlur}
									onChange={(event) => {
										field.handleChange(event.target.value);
										setPreview(null);
										setError(null);
									}}
									aria-describedby={`${id}-explanation`}
									aria-invalid={field.state.meta.errors.length > 0}
								/>
								<p id={`${id}-explanation`} className="text-sm text-muted-foreground">
									{t(
										"organization.tracking.activation-description",
										"Choose the real rollout date and review its impact before saving. The initial suggestion uses your organization’s creation date in its timezone. This changes tracking, without correcting anyone’s employment date.",
									)}
								</p>
								{field.state.meta.errors.length > 0 ? (
									<p role="alert" className="text-sm text-destructive">
										{t("organization.tracking.invalid-date", "Choose a valid calendar date.")}
									</p>
								) : null}
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
						{settings.active
							? t("organization.tracking.change-date", "Change tracking date")
							: t("organization.tracking.preview", "Preview impact")}
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
				{preview ? (
					<div className="space-y-4">
						<OrganizationTrackingImpact impact={preview} />
						<form.Field name="reason" validators={{ onChange: z.string().max(1000) }}>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor={`${id}-reason`}>
										{t("organization.tracking.reason", "Reason for this change")}
									</Label>
									<Textarea
										id={`${id}-reason`}
										name="reason"
										autoComplete="off"
										required
										maxLength={1000}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										disabled={busy}
									/>
								</div>
							)}
						</form.Field>
						<Button
							type="button"
							onClick={() => void commit()}
							disabled={busy || preview.blockers.length > 0}
						>
							{preview.kind === "activation"
								? t("organization.tracking.activate-reviewed", "Activate reviewed date")
								: t("organization.tracking.save-reviewed", "Save reviewed date")}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
