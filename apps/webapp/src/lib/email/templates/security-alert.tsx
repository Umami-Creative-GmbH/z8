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

type CopyText = { key: string; fallback: string };

/** Each security event's subject, title and description: the one place they are worded. */
const SECURITY_EVENT_COPY: Readonly<
	Record<SecurityEventType, { subject: CopyText; title: CopyText; description: CopyText }>
> = {
	password_changed: {
		subject: {
			key: "emails.subjects.passwordChanged",
			fallback: "Security Alert: Password Changed",
		},
		title: { key: "emails.securityAlert.passwordChanged.title", fallback: "Password changed" },
		description: {
			key: "emails.securityAlert.passwordChanged.description",
			fallback: "The password of your Z8 account was changed.",
		},
	},
	two_factor_enabled: {
		subject: {
			key: "emails.subjects.twoFactorEnabled",
			fallback: "Security Alert: Two-Factor Authentication Enabled",
		},
		title: {
			key: "emails.securityAlert.twoFactorEnabled.title",
			fallback: "Two-factor authentication enabled",
		},
		description: {
			key: "emails.securityAlert.twoFactorEnabled.description",
			fallback: "Two-factor authentication was turned on for your Z8 account.",
		},
	},
	two_factor_disabled: {
		subject: {
			key: "emails.subjects.twoFactorDisabled",
			fallback: "Security Alert: Two-Factor Authentication Disabled",
		},
		title: {
			key: "emails.securityAlert.twoFactorDisabled.title",
			fallback: "Two-factor authentication disabled",
		},
		description: {
			key: "emails.securityAlert.twoFactorDisabled.description",
			fallback: "Two-factor authentication was turned off for your Z8 account.",
		},
	},
};

/** The security alert's subject in the translator's language. */
export function securityAlertSubject(t: EmailTranslate, eventType: SecurityEventType): string {
	const { subject } = SECURITY_EVENT_COPY[eventType];
	return t(subject.key, subject.fallback);
}

function eventCopy(t: EmailTranslate, eventType: SecurityEventType) {
	const { title, description } = SECURITY_EVENT_COPY[eventType];
	return {
		title: t(title.key, title.fallback),
		description: t(description.key, description.fallback),
	};
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
