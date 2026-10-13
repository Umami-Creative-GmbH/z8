// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import { render } from "react-email";
import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import type { EmailTranslate } from "../email-i18n";
import { type EmailDetailRow, EmailLayout, EmailText } from "../layout/email-layout";

/**
 * A billing email's values, already text in the email's language (dates, amounts and
 * fallbacks formatted by the sender).
 */
export type BillingEmailValues = Record<string, string | number | undefined>;

export interface BillingEmailProps {
	templateKey: PlatformSystemEmailTemplateKey;
	/** The organization's default language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
	values: BillingEmailValues;
}

interface BillingEmailContent {
	subject: string;
	title: string;
	paragraphs: string[];
	details?: EmailDetailRow[];
	action: string;
}

function text(value: string | number | undefined): string {
	return value === undefined ? "" : String(value);
}

/** The default copy of one billing email in the email's language. */
function billingEmailContent(
	templateKey: PlatformSystemEmailTemplateKey,
	t: EmailTranslate,
	values: BillingEmailValues,
): BillingEmailContent {
	const planName = text(values.planName);
	const organizationName = text(values.organizationName);

	switch (templateKey) {
		case "billing-trial-ending": {
			const days = typeof values.daysRemaining === "number" ? values.daysRemaining : undefined;
			return {
				subject:
					days === undefined
						? t("emails.billing.trialEnding.subjectSoon", "Your Z8 trial ends soon")
						: t(
								"emails.billing.trialEnding.subject",
								"Your Z8 trial ends in {daysRemaining, plural, one {# day} other {# days}}",
								{ daysRemaining: days },
							),
				title: t("emails.billing.trialEnding.title", "Your trial is ending"),
				paragraphs: [
					t(
						"emails.billing.trialEnding.body",
						"Your {planName} trial for {organizationName} ends on {trialEndsAt}.",
						{ planName, organizationName, trialEndsAt: text(values.trialEndsAt) },
					),
					t(
						"emails.billing.trialEnding.paymentMethod",
						"To keep Z8 running without interruption, add a payment method in billing settings.",
					),
				],
				action: t("emails.billing.trialEnding.action", "Review billing settings"),
			};
		}
		case "billing-subscription-paused":
			return {
				subject: t("emails.billing.subscriptionPaused.subject", "Your Z8 subscription is paused"),
				title: t("emails.billing.subscriptionPaused.title", "Your subscription is paused"),
				paragraphs: [
					t(
						"emails.billing.subscriptionPaused.body",
						"The {planName} subscription for {organizationName} is paused.",
						{ planName, organizationName },
					),
					t(
						"emails.billing.subscriptionPaused.limits",
						"Time tracking data remains available, but paid plan features may be limited until billing is resumed.",
					),
				],
				action: t("emails.billing.subscriptionPaused.action", "Manage billing"),
			};
		case "billing-subscription-resumed":
			return {
				subject: t(
					"emails.billing.subscriptionResumed.subject",
					"Your Z8 subscription has resumed",
				),
				title: t("emails.billing.subscriptionResumed.title", "Your subscription has resumed"),
				paragraphs: [
					t(
						"emails.billing.subscriptionResumed.body",
						"The {planName} subscription for {organizationName} resumed on {resumeDate}.",
						{ planName, organizationName, resumeDate: text(values.resumeDate) },
					),
					t("emails.billing.subscriptionResumed.active", "Your paid Z8 features are active again."),
				],
				action: t("emails.billing.subscriptionResumed.action", "View billing details"),
			};
		case "billing-invoice-ready":
			return {
				subject: t(
					"emails.billing.invoiceReady.subject",
					"Your Z8 invoice {invoiceNumber} is ready",
					{ invoiceNumber: text(values.invoiceNumber) },
				),
				title: t("emails.billing.invoiceReady.title", "Your invoice is ready"),
				paragraphs: [
					t(
						"emails.billing.invoiceReady.body",
						"Invoice {invoiceNumber} for {organizationName} is ready.",
						{ invoiceNumber: text(values.invoiceNumber), organizationName },
					),
				],
				details: [
					{
						label: t("emails.billing.invoiceReady.amountLabel", "Amount due"),
						value: text(values.invoiceAmount),
					},
					{
						label: t("emails.billing.invoiceReady.dueDateLabel", "Due date"),
						value: text(values.dueDate),
					},
				],
				action: t("emails.billing.invoiceReady.action", "Open billing"),
			};
		case "billing-payment-failed":
			return {
				subject: t("emails.billing.paymentFailed.subject", "Action needed: Z8 payment failed"),
				title: t("emails.billing.paymentFailed.title", "Your payment failed"),
				paragraphs: [
					t(
						"emails.billing.paymentFailed.body",
						"We could not collect {invoiceAmount} for {organizationName}.",
						{ invoiceAmount: text(values.invoiceAmount), organizationName },
					),
					t(
						"emails.billing.paymentFailed.retry",
						"Please update your payment method before the next retry on {paymentRetryDate} to avoid service interruption.",
						{ paymentRetryDate: text(values.paymentRetryDate) },
					),
				],
				action: t("emails.billing.paymentFailed.action", "Update payment method"),
			};
	}
}

/**
 * `data` with the values Stripe did not provide (organization name, due date, retry
 * date) filled with copy in the email's language. Defaults and overrides both use it.
 */
export function withBillingFallbackValues(
	data: Record<string, unknown>,
	t: EmailTranslate,
): Record<string, unknown> {
	return {
		...data,
		organizationName:
			data.organizationName || t("emails.billing.values.yourOrganization", "your organization"),
		dueDate: data.dueDate || t("emails.billing.values.noDueDate", "not set"),
		paymentRetryDate: data.paymentRetryDate || t("emails.billing.values.retrySoon", "soon"),
	};
}

/** The default subject of a billing email in the email's language. */
export function billingEmailSubject(
	templateKey: PlatformSystemEmailTemplateKey,
	t: EmailTranslate,
	values: BillingEmailValues,
): string {
	return billingEmailContent(templateKey, t, values).subject;
}

/** A billing email's default body in the shared layout, in the organization's language. */
export function BillingEmail({ templateKey, locale, t, values }: BillingEmailProps) {
	const content = billingEmailContent(templateKey, t, values);
	const billingUrl = text(values.billingUrl);

	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={content.title}
			preview={content.paragraphs[0]}
			details={content.details}
			action={billingUrl ? { label: content.action, href: billingUrl } : undefined}
		>
			{content.paragraphs.map((paragraph) => (
				<EmailText key={paragraph}>{paragraph}</EmailText>
			))}
		</EmailLayout>
	);
}

/** `BillingEmail` as an HTML string. */
export async function renderBillingEmail(props: BillingEmailProps): Promise<string> {
	return render(BillingEmail(props));
}
