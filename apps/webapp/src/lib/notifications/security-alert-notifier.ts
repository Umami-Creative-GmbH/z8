import { getUserPrimaryOrganizationId } from "@/lib/auth/primary-organization";
import type { SecurityAlert } from "@/lib/auth/security-alerts";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SecurityAlertNotifier");

/**
 * Sends a security alert to the user (#1180): one notification, and its email, in
 * their primary organization (the earliest membership, as for sign-in emails). A
 * user without an organization has nowhere to receive it.
 */
export async function notifySecurityAlert({ event, userId, ...client }: SecurityAlert) {
	const organizationId = await getUserPrimaryOrganizationId(userId);
	if (!organizationId) {
		logger.info({ event, userId }, "No organization for the security alert");
		return;
	}
	// Loaded on use: Better Auth's config imports this, and the triggers reach the
	// whole notification channel graph.
	const triggers = await import("./triggers");
	const trigger = {
		password_changed: triggers.onPasswordChanged,
		two_factor_enabled: triggers.onTwoFactorEnabled,
		two_factor_disabled: triggers.onTwoFactorDisabled,
	}[event];
	await trigger({ userId, organizationId, ...client });
}
