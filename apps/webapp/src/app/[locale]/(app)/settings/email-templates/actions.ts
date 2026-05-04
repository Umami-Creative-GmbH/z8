"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { type EmailTemplateKey, organizationEmailTemplate } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email/email-service";
import {
	EMAIL_TEMPLATE_REGISTRY,
	type EmailTemplateDefinition,
	getEmailTemplateDefinition,
} from "@/lib/email/template-registry";
import {
	type EmailTemplateActionResult,
	type SaveEmailTemplateInput,
	validateEmailTemplateInput,
} from "@/lib/email/template-settings";
import { interpolateTemplate, sanitizeEmailHtml } from "@/lib/email/template-validation";

const EMAIL_TEMPLATE_SETTINGS_PATH = "/settings/email-templates";

type EmailTemplateListEntry = Omit<EmailTemplateDefinition, "renderDefault"> & {
	override: typeof organizationEmailTemplate.$inferSelect | null;
	starterDraftHtml: string;
	starterDraftPlainText: string;
};

function decodeHtmlEntities(value: string) {
	return value
		.replaceAll("&nbsp;", " ")
		.replaceAll("&#x27;", "'")
		.replaceAll("&quot;", '"')
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function htmlToPlainText(html: string) {
	return decodeHtmlEntities(
		html
			.replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
			.replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
			.replaceAll(/<!--[\s\S]*?-->/g, " ")
			.replaceAll(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
			.replaceAll(/<br\s*\/?>/gi, "\n")
			.replaceAll(/<[^>]*>/g, " ")
			.replaceAll(/[ \t]+/g, " ")
			.replaceAll(/\n\s+/g, "\n")
			.replaceAll(/\n{3,}/g, "\n\n")
			.trim(),
	);
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceStandaloneTextValue(text: string, previewValue: string, token: string) {
	return text.replace(
		new RegExp(`(^|[^\\w.])${escapeRegExp(previewValue)}(?![\\w.])`, "g"),
		`$1${token}`,
	);
}

function replaceTextNodeValues(html: string, previewValue: string, token: string) {
	return html.replace(/>([^<]+)</g, (match, text: string) => {
		return `>${replaceStandaloneTextValue(text, previewValue, token)}<`;
	});
}

function getGlobalPreviewReplacementValues(value: unknown) {
	if (Array.isArray(value)) {
		return [value.join(", "), value.join(","), value.join(" "), String(value)];
	}

	return typeof value === "string" ? [value] : [];
}

async function createSystemDraft(definition: EmailTemplateDefinition) {
	let starterDraftHtml = await definition.renderDefault(definition.previewData as never);
	const replacements = definition.variables
		.flatMap((variable) =>
			getGlobalPreviewReplacementValues(definition.previewData[variable.name]).map((previewValue) => ({
				previewValue,
				token: `{{${variable.name}}}`,
			})),
		)
		.filter((replacement) => replacement.previewValue)
		.sort((left, right) => right.previewValue.length - left.previewValue.length);

	for (const { previewValue, token } of replacements) {
		starterDraftHtml = starterDraftHtml.split(previewValue).join(token);
	}

	for (const variable of definition.variables) {
		const previewValue = definition.previewData[variable.name];
		if (typeof previewValue === "number" || typeof previewValue === "boolean") {
			starterDraftHtml = replaceTextNodeValues(
				starterDraftHtml,
				String(previewValue),
				`{{${variable.name}}}`,
			);
		}
	}

	const starterDraftPlainText = htmlToPlainText(starterDraftHtml);

	return { starterDraftHtml, starterDraftPlainText };
}

export async function listEmailTemplates(): Promise<EmailTemplateListEntry[]> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const overrides = await db.query.organizationEmailTemplate.findMany({
		where: and(
			eq(organizationEmailTemplate.organizationId, organizationId),
			eq(organizationEmailTemplate.isEnabled, true),
		),
	});
	const overridesByTemplateKey = new Map(
		overrides
			.filter((override) => override.isEnabled)
			.map((override) => [override.templateKey, override]),
	);

	return Promise.all(
		EMAIL_TEMPLATE_REGISTRY.map(async (definition) => {
			const { renderDefault: _renderDefault, ...publicDefinition } = definition;

			return {
				...publicDefinition,
				...(await createSystemDraft(definition)),
				override: overridesByTemplateKey.get(definition.key) ?? null,
			};
		}),
	);
}

export async function saveEmailTemplate(
	input: SaveEmailTemplateInput,
): Promise<EmailTemplateActionResult> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateEmailTemplateInput(input);

	if (!validation.success) {
		return { success: false, errors: validation.errors };
	}

	const sanitizedHtml = sanitizeEmailHtml(input.html);

	if (!sanitizedHtml.trim()) {
		return { success: false, errors: ["HTML body is required"] };
	}

	await db
		.insert(organizationEmailTemplate)
		.values({
			organizationId,
			templateKey: input.templateKey,
			subject: input.subject,
			editorDocument: input.editorDocument as Record<string, unknown>,
			html: sanitizedHtml,
			plainText: input.plainText?.trim() ? input.plainText : null,
			isEnabled: true,
			createdByUserId: authContext.user.id,
			updatedByUserId: authContext.user.id,
		})
		.onConflictDoUpdate({
			target: [organizationEmailTemplate.organizationId, organizationEmailTemplate.templateKey],
			set: {
				subject: input.subject,
				editorDocument: input.editorDocument as Record<string, unknown>,
				html: sanitizedHtml,
				plainText: input.plainText?.trim() ? input.plainText : null,
				isEnabled: true,
				updatedByUserId: authContext.user.id,
			},
		});

	revalidatePath(EMAIL_TEMPLATE_SETTINGS_PATH);

	return { success: true };
}

export async function resetEmailTemplate(
	templateKey: EmailTemplateKey,
): Promise<EmailTemplateActionResult> {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	try {
		getEmailTemplateDefinition(templateKey);
	} catch {
		return { success: false, errors: ["Unknown email template"] };
	}

	await db
		.delete(organizationEmailTemplate)
		.where(
			and(
				eq(organizationEmailTemplate.organizationId, organizationId),
				eq(organizationEmailTemplate.templateKey, templateKey),
			),
		);

	revalidatePath(EMAIL_TEMPLATE_SETTINGS_PATH);

	return { success: true };
}

export async function sendEmailTemplateTest(
	input: SaveEmailTemplateInput,
): Promise<EmailTemplateActionResult> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateEmailTemplateInput(input);

	if (!validation.success) {
		return { success: false, errors: validation.errors };
	}

	const sanitizedHtml = sanitizeEmailHtml(input.html);

	if (!sanitizedHtml.trim()) {
		return { success: false, errors: ["HTML body is required"] };
	}

	const result = await sendEmail({
		to: authContext.user.email,
		organizationId,
		subject: interpolateTemplate(
			input.subject,
			getEmailTemplateDefinition(input.templateKey).previewData,
		),
		html: interpolateTemplate(
			sanitizedHtml,
			getEmailTemplateDefinition(input.templateKey).previewData,
		),
	});

	if (!result.success) {
		return { success: false, errors: ["Failed to send test email"] };
	}

	return { success: true };
}
