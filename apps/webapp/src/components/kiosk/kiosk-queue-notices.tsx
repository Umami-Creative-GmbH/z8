"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import type { KioskQueueNotice } from "@/lib/time-tracking/kiosk/offline-queue";
import { useKioskActionLabels } from "./kiosk-employee-panel";

interface KioskQueueNoticesProps {
	notices: KioskQueueNotice[];
	zone: string;
	locale: string;
	onDismiss: () => void;
}

/**
 * Clockings saved while the kiosk was offline that Z8 refused when the kiosk
 * reconnected (#1292): a short notice each, on the home screen, until dismissed.
 * The employee (or their manager) is also notified, and owners and admins see the
 * full list in the kiosk settings (#1290).
 */
export function KioskQueueNotices({ notices, zone, locale, onDismiss }: KioskQueueNoticesProps) {
	const { t } = useTranslate();
	const labels = useKioskActionLabels();

	function reason(code: KioskQueueNotice["code"]): string {
		switch (code) {
			case "wrong_pin":
			case "no_pin":
			case "pin_unsealable":
				return t("timeTracking.kiosk.queue.reason.pin", "The PIN was not accepted.");
			case "pin_locked":
				return t("timeTracking.kiosk.queue.reason.locked", "The PIN was locked.");
			case "employee_not_assigned":
				return t(
					"timeTracking.kiosk.queue.reason.notAssigned",
					"The employee cannot clock at this kiosk.",
				);
			case "kiosk_revoked":
			case "kiosk_rotated":
			case "contact_unverifiable":
				return t(
					"timeTracking.kiosk.queue.reason.kiosk",
					"The kiosk was no longer paired at that time.",
				);
			case "admission_window":
			case "clock_out_of_bounds":
				return t("timeTracking.kiosk.queue.reason.time", "Its time could not be accepted.");
			default:
				return t("timeTracking.kiosk.queue.reason.other", "Ask your manager.");
		}
	}

	if (notices.length === 0) return null;
	return (
		<section
			role="status"
			aria-label={t("timeTracking.kiosk.queue.title", "Offline clockings not accepted")}
			className="mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-amber-900 dark:text-amber-100"
		>
			<ul className="flex flex-col gap-2 text-lg">
				{notices.map((notice) => (
					<li key={notice.operationId} className="flex items-start gap-3">
						<IconAlertTriangle className="mt-1 size-5 shrink-0" aria-hidden="true" />
						<span>
							{t(
								"timeTracking.kiosk.queue.refused",
								"{name}: {action} at {time}, saved while offline, was not accepted. {reason}",
								{
									name: notice.employeeName,
									action: labels.buttons[notice.action],
									time: formatKioskTime(notice.occurredAt, zone, locale),
									reason: reason(notice.code),
								},
							)}
						</span>
					</li>
				))}
			</ul>
			<Button variant="outline" size="lg" className="h-12 self-end text-lg" onClick={onDismiss}>
				{t("timeTracking.kiosk.queue.dismiss", "Dismiss")}
			</Button>
		</section>
	);
}
