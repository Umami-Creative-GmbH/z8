import { createHash } from "node:crypto";
import { createLogger } from "@/lib/logger";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import { createNotification } from "./notification-service";

const logger = createLogger("FormerEmployeeReportsWithoutManager");

const copy = {
	titleKey: "common:notifications.content.formerEmployeeReportsWithoutManager.title",
	titleDefault: "Employees without a current manager",
	messageKey: "common:notifications.content.formerEmployeeReportsWithoutManager.message",
	messageDefault:
		"{count, plural, one {# employee is} other {# employees are}} still linked only to a former manager: {names}. Assign a current manager.",
} as const satisfies NotificationCopy;

export type ReportWithoutManager = { employeeId: string; name: string };

export type FormerEmployeeReportsWithoutManagerNotice = {
	organizationId: string;
	/** Reports whose only manager links point to former employees. */
	reports: readonly ReportWithoutManager[];
	/** The organization's current owners and admins. */
	recipientUserIds: readonly string[];
};

export function employeeSettingsUrl(employeeId: string): string {
	return `/settings/employees/${employeeId}`;
}

/**
 * Tells an organization's admins, once each, which reports kept their link to
 * a former manager because the deactivation backfill (#1442) could not choose
 * a replacement. One notification per admin lists every report; it links to
 * the report's employee page when there is one, else to Settings → Employees,
 * and carries every employee page in `metadata.reports`. Keyed by the listed
 * reports, so sending the same list again sends nothing new. Never throws.
 */
export async function notifyFormerEmployeeReportsWithoutManager(
	notice: FormerEmployeeReportsWithoutManagerNotice,
): Promise<void> {
	if (notice.reports.length === 0) return;
	const reports = notice.reports.map((report) => ({
		employeeId: report.employeeId,
		name: report.name,
		url: employeeSettingsUrl(report.employeeId),
	}));
	const names = reports.map((report) => report.name || report.employeeId).join(", ");
	const count = reports.length;
	// The stored English fallback; the ICU plural is rendered per recipient on delivery.
	const message = `${count === 1 ? "1 employee is" : `${count} employees are`} still linked only to a former manager: ${names}. Assign a current manager.`;
	const listKey = createHash("sha256")
		.update(
			reports
				.map((report) => report.employeeId)
				.toSorted()
				.join(","),
		)
		.digest("hex")
		.slice(0, 16);
	const single = reports.length === 1 ? reports[0] : undefined;
	for (const userId of notice.recipientUserIds) {
		try {
			await createNotification({
				userId,
				organizationId: notice.organizationId,
				type: "former_employee_reports_without_manager",
				title: copy.titleDefault,
				message,
				...(single ? { entityType: "employee", entityId: single.employeeId } : {}),
				actionUrl: single ? single.url : "/settings/employees",
				idempotencyKey: `former-reports-without-manager:${listKey}:${userId}`,
				metadata: { i18n: translatedContent(copy, { count, names }).i18n, reports },
			});
		} catch (error) {
			logger.error(
				{ error, organizationId: notice.organizationId },
				"Failed to tell admins about reports left with only a former manager",
			);
		}
	}
}
