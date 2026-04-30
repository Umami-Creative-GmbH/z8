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
	defaultPreviewHtml: string;
	defaultPreviewPlainText: string;
};

function htmlToPlainText(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
}

export async function listEmailTemplates(): Promise<EmailTemplateListEntry[]> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const overrides = await db.query.organizationEmailTemplate.findMany({
		where: and(eq(organizationEmailTemplate.organizationId, organizationId)),
	});
	const overridesByTemplateKey = new Map(
		overrides.map((override) => [override.templateKey, override]),
	);

	return Promise.all(
		EMAIL_TEMPLATE_REGISTRY.map(async ({ renderDefault, ...definition }) => {
			const renderPreview = renderDefault as (data: Record<string, unknown>) => Promise<string>;
			const defaultPreviewHtml = await renderPreview(definition.previewData);

			return {
				...definition,
				defaultPreviewHtml,
				defaultPreviewPlainText: htmlToPlainText(defaultPreviewHtml),
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
			isEnabled: input.isEnabled,
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
				isEnabled: input.isEnabled,
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
