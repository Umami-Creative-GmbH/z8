// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { type EmailDetailRow, EmailLayout, EmailText } from "../layout/email-layout";

export type SecurityEventType = "password_changed" | "two_factor_enabled" | "two_factor_disabled";

/** The security alert's data; also the `{{variables}}` of its override. */
export type SecurityAlertData = {
	userName: string;
	eventType: SecurityEventType;
	/** When it happened, already formatted in the organization timezone with the zone printed. */
	timestamp: string;
	ipAddress?: string;
	userAgent?: string;
	securitySettingsUrl: string;
	appUrl: string;
};

export interface SecurityAlertProps extends SecurityAlertData {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

function eventCopy(t: EmailTranslate, eventType: SecurityEventType) {
	switch (eventType) {
		case "password_changed":
			return {
				title: t("emails.securityAlert.passwordChanged.title", "Password changed"),
				description: t(
					"emails.securityAlert.passwordChanged.description",
					"The password of your Z8 account was changed.",
				),
			};
		case "two_factor_enabled":
			return {
				title: t(
					"emails.securityAlert.twoFactorEnabled.title",
					"Two-factor authentication enabled",
				),
				description: t(
					"emails.securityAlert.twoFactorEnabled.description",
					"Two-factor authentication was turned on for your Z8 account.",
				),
			};
		case "two_factor_disabled":
			return {
				title: t(
					"emails.securityAlert.twoFactorDisabled.title",
					"Two-factor authentication disabled",
				),
				description: t(
					"emails.securityAlert.twoFactorDisabled.description",
					"Two-factor authentication was turned off for your Z8 account.",
				),
			};
	}
}

// No inbox preview: the default body is also the override starter draft, whose plain text
// would pick up the preview's hidden padding.
export function SecurityAlert({
	locale,
	t,
	userName,
	eventType,
	timestamp,
	ipAddress,
	userAgent,
	securitySettingsUrl,
}: SecurityAlertProps) {
	const copy = eventCopy(t, eventType);
	const details: EmailDetailRow[] = [
		{ label: t("emails.securityAlert.event", "Event"), value: copy.title },
		{ label: t("emails.securityAlert.time", "Time"), value: timestamp },
	];
	if (ipAddress) {
		details.push({ label: t("emails.securityAlert.ipAddress", "IP address"), value: ipAddress });
	}
	if (userAgent) {
		details.push({ label: t("emails.securityAlert.device", "Device"), value: userAgent });
	}

	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={copy.title}
			details={details}
			action={{
				label: t("emails.securityAlert.action", "Review security settings"),
				href: securitySettingsUrl,
			}}
		>
			<EmailText>{t("emails.common.greeting", "Hi {name},", { name: userName })}</EmailText>
			<EmailText>{copy.description}</EmailText>
			<EmailText>
				{t(
					"emails.securityAlert.notYou",
					"If you did not make this change, secure your account now: change your password and review your security settings.",
				)}
			</EmailText>
		</EmailLayout>
	);
}

export default SecurityAlert;
