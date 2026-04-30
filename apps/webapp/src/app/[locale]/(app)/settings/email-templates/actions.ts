import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationEmailTemplate, type EmailTemplateKey } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email/email-service";
import {
	EMAIL_TEMPLATE_REGISTRY,
	getEmailTemplateDefinition,
	type EmailTemplateDefinition,
} from "@/lib/email/template-registry";
import {
	interpolateTemplate,
	sanitizeEmailHtml,
	validateTemplateContent,
} from "@/lib/email/template-validation";

const EMAIL_TEMPLATE_SETTINGS_PATH = "/settings/email-templates";

export interface SaveEmailTemplateInput {
	templateKey: EmailTemplateKey;
	subject: string;
	html: string;
	editorDocument: unknown;
	plainText?: string;
	isEnabled: boolean;
}

export interface EmailTemplateActionResult {
	success: boolean;
	errors?: string[];
}

export interface EmailTemplateValidationResult {
	success: boolean;
	errors: string[];
}

type EmailTemplateListEntry = Omit<EmailTemplateDefinition, "renderDefault"> & {
	override: typeof organizationEmailTemplate.$inferSelect | null;
};

export function validateEmailTemplateInput(
	input: SaveEmailTemplateInput,
): EmailTemplateValidationResult {
	const errors: string[] = [];
	let definition: EmailTemplateDefinition;

	try {
		definition = getEmailTemplateDefinition(input.templateKey);
	} catch {
		return { success: false, errors: ["Unknown email template"] };
	}

	if (
		typeof input.editorDocument !== "object" ||
		input.editorDocument === null ||
		Array.isArray(input.editorDocument)
	) {
		errors.push("Editor document must be an object");
	}

	const contentValidation = validateTemplateContent({
		subject: input.subject,
		html: input.plainText ? `${input.html}\n${input.plainText}` : input.html,
		allowedVariables: definition.variables,
	});

	errors.push(...contentValidation.errors);

	return {
		success: errors.length === 0,
		errors,
	};
}

export async function listEmailTemplates(): Promise<EmailTemplateListEntry[]> {
	"use server";

	const { organizationId } = await requireOrgAdminSettingsAccess();
	const overrides = await db.query.organizationEmailTemplate.findMany({
		where: and(eq(organizationEmailTemplate.organizationId, organizationId)),
	});
	const overridesByTemplateKey = new Map(
		overrides.map((override) => [override.templateKey, override]),
	);

	return EMAIL_TEMPLATE_REGISTRY.map(({ renderDefault: _renderDefault, ...definition }) => ({
		...definition,
		override: overridesByTemplateKey.get(definition.key) ?? null,
	}));
}

export async function saveEmailTemplate(
	input: SaveEmailTemplateInput,
): Promise<EmailTemplateActionResult> {
	"use server";

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
	"use server";

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
	"use server";

	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateEmailTemplateInput(input);

	if (!validation.success) {
		return { success: false, errors: validation.errors };
	}

	const sanitizedHtml = sanitizeEmailHtml(input.html);

	if (!sanitizedHtml.trim()) {
		return { success: false, errors: ["HTML body is required"] };
	}

	await sendEmail({
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

	return { success: true };
}
