"use client";

import {
	IconDownload,
	IconExternalLink,
	IconId,
	IconLoader2,
	IconShieldOff,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTolgee, type useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	type EmployeeKioskBadgeState,
	type IssuedKioskBadgePdf,
	issueEmployeeKioskBadgeAction,
	replaceEmployeeKioskBadgeAction,
	revokeEmployeeKioskBadgeAction,
} from "@/app/[locale]/(app)/settings/employees/kiosk-actions";
import { Button } from "@/components/ui/button";
import type { KioskBadgeActionResult } from "@/lib/time-tracking/kiosk/badge-errors";
import { kioskBadgeErrorMessage } from "./kiosk-badge-error-message";

type Translate = ReturnType<typeof useTranslate>["t"];

/** A just-issued badge PDF as a local file; it lives only in this component's state. */
type IssuedFile = { url: string; filename: string };

/** An instant's date in the organization's zone, in the UI language. */
function dateLabel(iso: string, zone: string, locale: string): string {
	return Temporal.Instant.from(iso)
		.toZonedDateTimeISO(zone)
		.toPlainDate()
		.toLocaleString(locale, { dateStyle: "medium" });
}

/** A calendar day (ISO date) as it is, in the UI language. */
function dayLabel(day: string, locale: string): string {
	return Temporal.PlainDate.from(day).toLocaleString(locale, { dateStyle: "medium" });
}

const SPINNER = "mr-2 size-4 animate-spin motion-reduce:animate-none";

function pdfFile(issued: IssuedKioskBadgePdf): IssuedFile {
	const bytes = Uint8Array.from(atob(issued.pdf), (character) => character.charCodeAt(0));
	const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
	return { url, filename: issued.filename };
}

function BadgeStatus({
	badge,
	locale,
	t,
}: {
	badge: EmployeeKioskBadgeState;
	locale: string;
	t: Translate;
}) {
	if (badge.activeIssuedAt) {
		return t("settings.employees.kioskBadge.active", "Active since {date}.", {
			date: dateLabel(badge.activeIssuedAt, badge.timezone, locale),
		});
	}
	if (badge.lastRevokedAt && badge.lastRevokedReason === "employee_departure") {
		return t(
			"settings.employees.kioskBadge.endedByDeparture",
			"No active kiosk badge. The last one ended with the employee's departure on {date}. Old copies never work again, not even after a rehire.",
			{
				// The departure date people know is the last working day, not the cutoff after it.
				date: badge.departureLastWorkingDay
					? dayLabel(badge.departureLastWorkingDay, locale)
					: dateLabel(badge.lastRevokedAt, badge.timezone, locale),
			},
		);
	}
	if (badge.lastRevokedAt) {
		return t(
			"settings.employees.kioskBadge.revokedOn",
			"No active kiosk badge. The last one was revoked on {date}.",
			{ date: dateLabel(badge.lastRevokedAt, badge.timezone, locale) },
		);
	}
	return t("settings.employees.kioskBadge.none", "No kiosk badge yet.");
}

/**
 * The employee's kiosk badge (#1364, ADR 0013) for owners, admins and their
 * direct manager: issue, replace and revoke. An issued badge's PDF exists only
 * here, until Done or leaving the page; the server cannot produce it again.
 */
export function KioskBadgeSection({
	employeeId,
	badge,
	onChanged,
	t,
}: {
	employeeId: string;
	badge: EmployeeKioskBadgeState;
	onChanged: () => Promise<unknown>;
	t: Translate;
}) {
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [issued, setIssued] = useState<IssuedFile | null>(null);
	const [confirming, setConfirming] = useState<"replace" | "revoke" | null>(null);

	// The PDF is dropped with the component: nothing keeps it after the page.
	useEffect(() => {
		if (!issued) return;
		return () => URL.revokeObjectURL(issued.url);
	}, [issued]);

	const refused = <T,>(result: KioskBadgeActionResult<T>) => {
		if (result.success) return false;
		toast.error(kioskBadgeErrorMessage(t, result.code));
		// Someone else changed the badge: show what is true now.
		if (result.code === "badge_changed") void onChanged();
		return true;
	};
	const failed = () => toast.error(kioskBadgeErrorMessage(t, "failed"));

	// Replace and revoke name the badge this card shows, so a change made meanwhile is refused.
	const shownBadgeId = badge.activeBadgeId ?? "";
	const issueMutation = useMutation({
		mutationFn: (kind: "issue" | "replace") =>
			kind === "issue"
				? issueEmployeeKioskBadgeAction(employeeId)
				: replaceEmployeeKioskBadgeAction(employeeId, shownBadgeId),
		onSuccess: (result) => {
			setConfirming(null);
			if (refused(result) || !result.success) return;
			setIssued(pdfFile(result.data));
			void onChanged();
		},
		onError: failed,
	});
	const { reset: forgetIssued } = issueMutation;
	// The mutation keeps the PDF (and so the credential) in its result until reset:
	// Done and leaving the page drop it from client memory too.
	useEffect(() => forgetIssued, [forgetIssued]);
	function done() {
		setIssued(null);
		forgetIssued();
	}
	const revokeMutation = useMutation({
		mutationFn: () => revokeEmployeeKioskBadgeAction(employeeId, shownBadgeId),
		onSuccess: (result) => {
			setConfirming(null);
			if (refused(result)) return;
			done();
			toast.success(t("settings.employees.kioskBadge.revoked", "Kiosk badge revoked"));
			void onChanged();
		},
		onError: failed,
	});
	const busy = issueMutation.isPending || revokeMutation.isPending;
	const headingId = `kiosk-badge-${employeeId}`;

	return (
		<section className="space-y-3" aria-labelledby={headingId}>
			<h3 id={headingId} className="flex items-center gap-2 text-sm font-medium">
				<IconId className="size-4 text-muted-foreground" aria-hidden="true" />
				{t("settings.employees.kioskBadge.heading", "Kiosk badge")}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.employees.kioskBadge.description",
					"A printed QR code the employee scans at an online kiosk instead of entering their PIN. It never signs anyone in.",
				)}
			</p>
			<p className="text-sm" aria-live="polite">
				<BadgeStatus badge={badge} locale={locale} t={t} />
			</p>

			{issued && (
				<div className="space-y-3 rounded-md border bg-muted/50 p-3" role="status">
					<p className="text-sm">
						{t(
							"settings.employees.kioskBadge.saveNow",
							"Save the PDF now: Z8 cannot show this badge again. You can reprint a saved copy. If the file or the badge is lost, replace the badge.",
						)}
					</p>
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
						<Button asChild>
							<a href={issued.url} download={issued.filename}>
								<IconDownload className="mr-2 size-4" aria-hidden="true" />
								{t("settings.employees.kioskBadge.download", "Download PDF")}
							</a>
						</Button>
						<Button asChild variant="outline">
							<a href={issued.url} target="_blank" rel="noopener noreferrer">
								<IconExternalLink className="mr-2 size-4" aria-hidden="true" />
								{t("settings.employees.kioskBadge.openToPrint", "Open to print")}
							</a>
						</Button>
						<Button variant="ghost" onClick={done}>
							{t("settings.employees.kioskBadge.done", "Done")}
						</Button>
					</div>
				</div>
			)}

			{confirming && (
				<p className="text-sm text-muted-foreground" role="alert">
					{confirming === "replace"
						? t(
								"settings.employees.kioskBadge.confirmReplaceText",
								"Replacing creates a new badge. Every copy of the current badge stops working at once.",
							)
						: t(
								"settings.employees.kioskBadge.confirmRevokeText",
								"Every copy of this badge stops working for good. The employee's kiosk PIN keeps working.",
							)}
				</p>
			)}

			{!badge.activeIssuedAt && !badge.canIssue && (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.employees.kioskBadge.notEligible",
						"A new badge can be issued only while the employee is active. After a rehire, issue a new badge.",
					)}
				</p>
			)}

			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				{!badge.activeIssuedAt ? (
					badge.canIssue && (
						<Button onClick={() => issueMutation.mutate("issue")} disabled={busy}>
							{issueMutation.isPending && <IconLoader2 className={SPINNER} aria-hidden="true" />}
							{t("settings.employees.kioskBadge.issue", "Issue badge")}
						</Button>
					)
				) : confirming ? (
					<>
						<Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
							{t("common.cancel", "Cancel")}
						</Button>
						{confirming === "replace" ? (
							<Button onClick={() => issueMutation.mutate("replace")} disabled={busy}>
								{issueMutation.isPending && <IconLoader2 className={SPINNER} aria-hidden="true" />}
								{t("settings.employees.kioskBadge.confirmReplace", "Replace the badge")}
							</Button>
						) : (
							<Button variant="destructive" onClick={() => revokeMutation.mutate()} disabled={busy}>
								{revokeMutation.isPending && <IconLoader2 className={SPINNER} aria-hidden="true" />}
								{t("settings.employees.kioskBadge.confirmRevoke", "Revoke the badge")}
							</Button>
						)}
					</>
				) : (
					<>
						{badge.canIssue && (
							<Button variant="outline" onClick={() => setConfirming("replace")} disabled={busy}>
								{t("settings.employees.kioskBadge.replace", "Replace badge")}
							</Button>
						)}
						<Button variant="outline" onClick={() => setConfirming("revoke")} disabled={busy}>
							<IconShieldOff className="mr-2 size-4" aria-hidden="true" />
							{t("settings.employees.kioskBadge.revoke", "Revoke badge")}
						</Button>
					</>
				)}
			</div>
		</section>
	);
}
