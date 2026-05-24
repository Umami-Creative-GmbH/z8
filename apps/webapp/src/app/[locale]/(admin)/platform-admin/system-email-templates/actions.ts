"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db";
import {
	platformSystemEmailTemplate,
	type PlatformSystemEmailTemplateKey,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email/email-service";
import {
	PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY,
	type PlatformSystemEmailTemplateDefinition,
	getPlatformSystemEmailTemplateDefinition,
} from "@/lib/email/system-template-registry";
import {
	type PlatformSystemEmailTemplateActionResult,
	type SavePlatformSystemEmailTemplateInput,
	validatePlatformSystemEmailTemplateInput,
} from "@/lib/email/system-template-settings";
import { interpolateTemplate, sanitizeEmailHtml } from "@/lib/email/template-validation";

const PLATFORM_SYSTEM_EMAIL_TEMPLATE_SETTINGS_PATH =
	"/platform-admin/system-email-templates";

type PlatformSystemEmailTemplateListEntry = Omit<
	PlatformSystemEmailTemplateDefinition,
	"renderDefault"
> & {
	override: typeof platformSystemEmailTemplate.$inferSelect | null;
	starterDraftHtml: string;
	starterDraftPlainText: string;
};

interface PlatformAdminSession {
	user: {
		id: string;
		email: string;
		role?: string | null;
	};
}

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
	return html.replace(/>([^<]+)</g, (_match, text: string) => {
		return `>${replaceStandaloneTextValue(text, previewValue, token)}<`;
	});
}

function getGlobalPreviewReplacementValues(value: unknown) {
	if (Array.isArray(value)) {
		return [value.join(", "), value.join(","), value.join(" "), String(value)];
	}

	return typeof value === "string" ? [value] : [];
}

async function createSystemDraft(definition: PlatformSystemEmailTemplateDefinition) {
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

async function requirePlatformAdminSession(): Promise<
	{ success: true; session: PlatformAdminSession } | { success: false; errors: string[] }
> {
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user || session.user.role !== "admin") {
		return { success: false, errors: ["Unauthorized"] };
	}

	return { success: true, session: session as PlatformAdminSession };
}

export async function listPlatformSystemEmailTemplates(): Promise<
	PlatformSystemEmailTemplateListEntry[]
> {
	const authResult = await requirePlatformAdminSession();

	if (!authResult.success) {
		return [];
	}

	const overrides = await db.query.platformSystemEmailTemplate.findMany();
	const overridesByTemplateKey = new Map(
		overrides
			.filter((override) => override.isEnabled)
			.map((override) => [override.templateKey, override]),
	);

	return Promise.all(
		PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY.map(async (definition) => {
			const { renderDefault: _renderDefault, ...publicDefinition } = definition;

			return {
				...publicDefinition,
				...(await createSystemDraft(definition)),
				override: overridesByTemplateKey.get(definition.key) ?? null,
			};
		}),
	);
}

export async function savePlatformSystemEmailTemplate(
	input: SavePlatformSystemEmailTemplateInput,
): Promise<PlatformSystemEmailTemplateActionResult> {
	const authResult = await requirePlatformAdminSession();

	if (!authResult.success) {
		return { success: false, errors: authResult.errors };
	}

	const validation = validatePlatformSystemEmailTemplateInput(input);

	if (!validation.success) {
		return { success: false, errors: validation.errors };
	}

	const sanitizedHtml = sanitizeEmailHtml(input.html);

	if (!sanitizedHtml.trim()) {
		return { success: false, errors: ["HTML body is required"] };
	}

	await db
		.insert(platformSystemEmailTemplate)
		.values({
			templateKey: input.templateKey,
			subject: input.subject,
			editorDocument: input.editorDocument as Record<string, unknown>,
			html: sanitizedHtml,
			plainText: input.plainText?.trim() ? input.plainText : null,
			isEnabled: input.isEnabled ?? true,
			createdByUserId: authResult.session.user.id,
			updatedByUserId: authResult.session.user.id,
		})
		.onConflictDoUpdate({
			target: [platformSystemEmailTemplate.templateKey],
			set: {
				subject: input.subject,
				editorDocument: input.editorDocument as Record<string, unknown>,
				html: sanitizedHtml,
				plainText: input.plainText?.trim() ? input.plainText : null,
				isEnabled: input.isEnabled ?? true,
				updatedByUserId: authResult.session.user.id,
			},
		});

	revalidatePath(PLATFORM_SYSTEM_EMAIL_TEMPLATE_SETTINGS_PATH);

	return { success: true };
}

export async function resetPlatformSystemEmailTemplate(
	templateKey: PlatformSystemEmailTemplateKey,
): Promise<PlatformSystemEmailTemplateActionResult> {
	const authResult = await requirePlatformAdminSession();

	if (!authResult.success) {
		return { success: false, errors: authResult.errors };
	}

	try {
		getPlatformSystemEmailTemplateDefinition(templateKey);
	} catch {
		return { success: false, errors: ["Unknown platform system email template"] };
	}

	await db
		.delete(platformSystemEmailTemplate)
		.where(and(eq(platformSystemEmailTemplate.templateKey, templateKey)));

	revalidatePath(PLATFORM_SYSTEM_EMAIL_TEMPLATE_SETTINGS_PATH);

	return { success: true };
}

export async function sendPlatformSystemEmailTemplateTest(
	input: SavePlatformSystemEmailTemplateInput,
): Promise<PlatformSystemEmailTemplateActionResult> {
	const authResult = await requirePlatformAdminSession();

	if (!authResult.success) {
		return { success: false, errors: authResult.errors };
	}

	const validation = validatePlatformSystemEmailTemplateInput(input);

	if (!validation.success) {
		return { success: false, errors: validation.errors };
	}

	const sanitizedHtml = sanitizeEmailHtml(input.html);

	if (!sanitizedHtml.trim()) {
		return { success: false, errors: ["HTML body is required"] };
	}

	const previewData = getPlatformSystemEmailTemplateDefinition(input.templateKey).previewData;
	const result = await sendEmail({
		to: authResult.session.user.email,
		subject: interpolateTemplate(input.subject, previewData),
		html: interpolateTemplate(sanitizedHtml, previewData),
	});

	if (!result.success) {
		return { success: false, errors: ["Failed to send test email"] };
	}

	return { success: true };
}
