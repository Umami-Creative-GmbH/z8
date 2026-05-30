import type { PlatformSystemEmailTemplateKey } from "@/db/schema";

export type PlatformSystemEmailTemplateCategory = "billing";

export interface PlatformSystemEmailTemplateVariableDefinition {
	name: string;
	label: string;
	description: string;
	example: string;
}

export interface PlatformSystemEmailTemplateDefinition<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	key: PlatformSystemEmailTemplateKey;
	category: PlatformSystemEmailTemplateCategory;
	label: string;
	description: string;
	defaultSubject: string;
	variables: PlatformSystemEmailTemplateVariableDefinition[];
	previewData: TData;
	renderDefault(data: TData): Promise<string>;
}

const billingUrl = "https://app.z8-time.app/settings/billing";

const variableExamples: Record<string, string> = {
	billingUrl,
	daysRemaining: "3",
	dueDate: "June 1, 2026",
	invoiceAmount: "EUR 149.00",
	invoiceNumber: "INV-2026-0042",
	organizationName: "Acme Operations",
	paymentRetryDate: "May 27, 2026",
	planName: "Business",
	resumeDate: "May 24, 2026",
	subscriptionStatus: "active",
	trialEndsAt: "May 27, 2026",
};

const variable = (
	name: string,
	label: string,
	description: string,
): PlatformSystemEmailTemplateVariableDefinition => ({
	name,
	label,
	description,
	example: variableExamples[name] ?? "Example value",
});

const escapeHtml = (value: unknown) =>
	String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const paragraph = (text: string) => `<p>${text}</p>`;

export const PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY = [
	{
		key: "billing-trial-ending",
		category: "billing",
		label: "Trial ending",
		description: "Notifies an organization that its trial is about to end.",
		defaultSubject: "Your Z8 trial ends in {{daysRemaining}} days",
		variables: [
			variable("organizationName", "Organization name", "Name of the organization in trial."),
			variable("planName", "Plan name", "Name of the plan selected for the trial."),
			variable("daysRemaining", "Days remaining", "Number of days left in the trial."),
			variable("trialEndsAt", "Trial ends at", "Date when the trial ends."),
			variable("billingUrl", "Billing URL", "Link to billing settings."),
		],
		previewData: {
			organizationName: "Acme Operations",
			planName: "Business",
			daysRemaining: 3,
			trialEndsAt: "May 27, 2026",
			billingUrl,
		},
		async renderDefault(data) {
			return [
				paragraph(
					`Your ${escapeHtml(data.planName)} trial for ${escapeHtml(data.organizationName)} ends in ${escapeHtml(data.daysRemaining)} days.`,
				),
				paragraph(
					`To keep Z8 running without interruption after ${escapeHtml(data.trialEndsAt)}, add a payment method in billing settings.`,
				),
				paragraph(`<a href="${escapeHtml(data.billingUrl)}">Review billing settings</a>`),
			].join("");
		},
	},
	{
		key: "billing-subscription-paused",
		category: "billing",
		label: "Subscription paused",
		description: "Notifies an organization that its subscription has been paused.",
		defaultSubject: "Your Z8 subscription is paused",
		variables: [
			variable("organizationName", "Organization name", "Name of the affected organization."),
			variable("planName", "Plan name", "Name of the paused plan."),
			variable("subscriptionStatus", "Subscription status", "Current subscription status."),
			variable("billingUrl", "Billing URL", "Link to billing settings."),
		],
		previewData: {
			organizationName: "Acme Operations",
			planName: "Business",
			subscriptionStatus: "paused",
			billingUrl,
		},
		async renderDefault(data) {
			return [
				paragraph(
					`The ${escapeHtml(data.planName)} subscription for ${escapeHtml(data.organizationName)} is now ${escapeHtml(data.subscriptionStatus)}.`,
				),
				paragraph(
					"Time tracking data remains available, but paid plan features may be limited until billing is resumed.",
				),
				paragraph(`<a href="${escapeHtml(data.billingUrl)}">Manage billing</a>`),
			].join("");
		},
	},
	{
		key: "billing-subscription-resumed",
		category: "billing",
		label: "Subscription resumed",
		description: "Confirms that an organization's subscription has resumed.",
		defaultSubject: "Your Z8 subscription has resumed",
		variables: [
			variable("organizationName", "Organization name", "Name of the affected organization."),
			variable("planName", "Plan name", "Name of the resumed plan."),
			variable("resumeDate", "Resume date", "Date when the subscription resumed."),
			variable("billingUrl", "Billing URL", "Link to billing settings."),
		],
		previewData: {
			organizationName: "Acme Operations",
			planName: "Business",
			resumeDate: "May 24, 2026",
			billingUrl,
		},
		async renderDefault(data) {
			return [
				paragraph(
					`The ${escapeHtml(data.planName)} subscription for ${escapeHtml(data.organizationName)} resumed on ${escapeHtml(data.resumeDate)}.`,
				),
				paragraph("Your paid Z8 features are active again."),
				paragraph(`<a href="${escapeHtml(data.billingUrl)}">View billing details</a>`),
			].join("");
		},
	},
	{
		key: "billing-invoice-ready",
		category: "billing",
		label: "Invoice ready",
		description: "Notifies an organization that a billing invoice is available.",
		defaultSubject: "Your Z8 invoice {{invoiceNumber}} is ready",
		variables: [
			variable("organizationName", "Organization name", "Name of the billed organization."),
			variable("invoiceNumber", "Invoice number", "Invoice identifier."),
			variable("invoiceAmount", "Invoice amount", "Total invoice amount."),
			variable("dueDate", "Due date", "Invoice due date."),
			variable("billingUrl", "Billing URL", "Link to billing settings."),
		],
		previewData: {
			organizationName: "Acme Operations",
			invoiceNumber: "INV-2026-0042",
			invoiceAmount: "EUR 149.00",
			dueDate: "June 1, 2026",
			billingUrl,
		},
		async renderDefault(data) {
			return [
				paragraph(
					`Invoice ${escapeHtml(data.invoiceNumber)} for ${escapeHtml(data.organizationName)} is ready.`,
				),
				paragraph(
					`Amount due: ${escapeHtml(data.invoiceAmount)}. Due date: ${escapeHtml(data.dueDate)}.`,
				),
				paragraph(`<a href="${escapeHtml(data.billingUrl)}">Open billing</a>`),
			].join("");
		},
	},
	{
		key: "billing-payment-failed",
		category: "billing",
		label: "Payment failed",
		description: "Notifies an organization that a subscription payment failed.",
		defaultSubject: "Action needed: Z8 payment failed",
		variables: [
			variable("organizationName", "Organization name", "Name of the affected organization."),
			variable("invoiceAmount", "Invoice amount", "Amount that could not be collected."),
			variable("paymentRetryDate", "Payment retry date", "Date when payment will be retried."),
			variable("billingUrl", "Billing URL", "Link to update billing details."),
		],
		previewData: {
			organizationName: "Acme Operations",
			invoiceAmount: "EUR 149.00",
			paymentRetryDate: "May 27, 2026",
			billingUrl,
		},
		async renderDefault(data) {
			return [
				paragraph(
					`We could not collect ${escapeHtml(data.invoiceAmount)} for ${escapeHtml(data.organizationName)}.`,
				),
				paragraph(
					`Please update your payment method before the next retry on ${escapeHtml(data.paymentRetryDate)} to avoid service interruption.`,
				),
				paragraph(`<a href="${escapeHtml(data.billingUrl)}">Update payment method</a>`),
			].join("");
		},
	},
] satisfies PlatformSystemEmailTemplateDefinition[];

export function getPlatformSystemEmailTemplateDefinition(key: PlatformSystemEmailTemplateKey) {
	const definition = PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY.find((entry) => entry.key === key);

	if (!definition) {
		throw new Error(`Unknown platform system email template key: ${key}`);
	}

	return definition;
}
