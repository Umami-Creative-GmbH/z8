import type { CreateNotificationParams } from "./types";

/**
 * The recipient's own client details (a security alert's IP address and user agent,
 * #1180): for their notification and email only, never an organization's webhooks
 * or a copy forwarded to someone else.
 */
const RECIPIENT_ONLY_METADATA = ["ipAddress", "userAgent"] as const;

/** The metadata as anyone but the recipient may see it. */
export function withoutRecipientOnlyMetadata(
	metadata: CreateNotificationParams["metadata"],
): CreateNotificationParams["metadata"] {
	if (!metadata || !RECIPIENT_ONLY_METADATA.some((key) => key in metadata)) return metadata;
	const shared = { ...metadata };
	for (const key of RECIPIENT_ONLY_METADATA) delete shared[key];
	return shared;
}
