import { translatedContent } from "@/lib/notifications/notification-copy";
import type { AbsenceChangeRow } from "./change-request-store";

const STATUS_COPY = {
	pending: {
		titleKey: "common:notifications.content.absenceChangePending.title",
		titleDefault: "Absence change awaiting approval",
	},
	approved: {
		titleKey: "common:notifications.content.absenceChangeApproved.title",
		titleDefault: "Absence change request approved",
	},
	rejected: {
		titleKey: "common:notifications.content.absenceChangeRejected.title",
		titleDefault: "Absence change request rejected",
	},
	withdrawn: {
		titleKey: "common:notifications.content.absenceChangeWithdrawn.title",
		titleDefault: "Absence change request withdrawn",
	},
	obsolete: {
		titleKey: "common:notifications.content.absenceChangeObsolete.title",
		titleDefault: "Absence change request obsolete",
	},
	expired: {
		titleKey: "common:notifications.content.absenceChangeExpired.title",
		titleDefault: "Absence change request expired",
	},
};
const CHANGE_COPY = {
	messageKey: "common:notifications.content.absenceChange.message",
	messageDefault: "Recorded dates: {original}. Proposed dates: {proposed}. {decision}",
};
const CANCELLATION_COPY = {
	messageKey: "common:notifications.content.absenceCancellation.message",
	messageDefault: "Cancellation request for {original}. {decision}",
};
export function absenceChangeNotificationContent(request: AbsenceChangeRow) {
	return translatedContent(
		{
			...STATUS_COPY[request.status],
			...(request.kind === "cancel" ? CANCELLATION_COPY : CHANGE_COPY),
		},
		{
			original: {
				kind: "plainDateRange",
				start: request.original.startDate,
				end: request.original.endDate,
			},
			proposed: request.proposed
				? {
						kind: "plainDateRange",
						start: request.proposed.startDate,
						end: request.proposed.endDate,
					}
				: "",
			decision: request.decisionReason ?? "",
		},
	);
}
