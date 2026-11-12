"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { type EmailTemplateKey, organizationEmailTemplate } from "@/db/schema";
import { ExternalServiceError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { sendEmail } from "@/lib/email/email-service";
import {
	EMAIL_TEMPLATE_REGISTRY,
	type EmailTemplateDefinition,
	getEmailTemplateDefinition,
} from "@/lib/email/template-registry";
import {
	type SaveEmailTemplateInput,
	validateEmailTemplateInput,
} from "@/lib/email/template-settings";
import { interpolateTemplate, sanitizeEmailHtml } from "@/lib/email/template-validation";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const EMAIL_TEMPLATE_SETTINGS_PATH = "/settings/email-templates";

export type EmailTemplateListEntry = Omit<EmailTemplateDefinition, "renderDefault"> & {
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

async function createSystemDraft(definition: EmailTemplateDefinition) {
	let starterDraftHtml = await definition.renderDefault(definition.previewData as never);
	const replacements = definition.variables
		.flatMap((variable) =>
			getGlobalPreviewReplacementValues(definition.previewData[variable.name]).flatMap(
				(previewValue) =>
					previewValue
						? [
								{
									previewValue,
									token: `{{${variable.name}}}`,
								},
							]
						: [],
			),
		)
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

/**
 * A draft of an organization email template: the registry's template, content
 * that uses only its variables (`validateEmailTemplateInput`), and a body that
 * is not empty once sanitized. The parsed draft carries the sanitized body.
 */
const emailTemplateDraftSchema = z
	.custom<SaveEmailTemplateInput>()
	.superRefine((value, ctx) => {
		const draft =
			typeof value === "object" && value !== null ? value : ({} as SaveEmailTemplateInput);
		for (const message of validateEmailTemplateInput(draft).errors) {
			ctx.addIssue({ code: "custom", message });
		}
	})
	.transform((draft) => ({ ...draft, html: sanitizeEmailHtml(draft.html) }))
	.refine((draft) => draft.html.trim() !== "", "HTML body is required");

const emailTemplateKeySchema = z.custom<EmailTemplateKey>(
	(value) =>
		typeof value === "string" &&
		EMAIL_TEMPLATE_REGISTRY.some((definition) => definition.key === value),
	"Unknown email template",
);

function revalidateEmailTemplatePages() {
	revalidatePath(EMAIL_TEMPLATE_SETTINGS_PATH);
	revalidatePath("/settings/enterprise/email");
}

export const listEmailTemplates = organizationAction(
	{ name: "emailTemplates.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const overrides = yield* dbService.query("emailTemplates.list", () =>
				dbService.db.query.organizationEmailTemplate.findMany({
					where: and(
						eq(organizationEmailTemplate.organizationId, organizationId),
						eq(organizationEmailTemplate.isEnabled, true),
					),
				}),
			);
			const overridesByTemplateKey = new Map(
				overrides.flatMap((override) =>
					override.isEnabled ? [[override.templateKey, override] as const] : [],
				),
			);

			return yield* Effect.promise(
				(): Promise<EmailTemplateListEntry[]> =>
					Promise.all(
						EMAIL_TEMPLATE_REGISTRY.map(async (definition) => {
							const { renderDefault: _renderDefault, ...publicDefinition } = definition;

							return {
								...publicDefinition,
								...(await createSystemDraft(definition)),
								override: overridesByTemplateKey.get(definition.key) ?? null,
							};
						}),
					),
			);
		}),
);

export const saveEmailTemplate = organizationAction(
	{ name: "emailTemplates.save", requires: "orgAdmin", schema: emailTemplateDraftSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const plainText = input.plainText?.trim() ? input.plainText : null;
			yield* dbService.query("emailTemplates.save", () =>
				dbService.db
					.insert(organizationEmailTemplate)
					.values({
						organizationId,
						templateKey: input.templateKey,
						subject: input.subject,
						editorDocument: input.editorDocument as Record<string, unknown>,
						html: input.html,
						plainText,
						isEnabled: true,
						createdByUserId: actor.userId,
						updatedByUserId: actor.userId,
					})
					.onConflictDoUpdate({
						target: [
							organizationEmailTemplate.organizationId,
							organizationEmailTemplate.templateKey,
						],
						set: {
							subject: input.subject,
							editorDocument: input.editorDocument as Record<string, unknown>,
							html: input.html,
							plainText,
							isEnabled: true,
							updatedByUserId: actor.userId,
						},
					}),
			);

			revalidateEmailTemplatePages();
			return undefined;
		}),
);

export const resetEmailTemplate = organizationAction(
	{ name: "emailTemplates.reset", requires: "orgAdmin", schema: emailTemplateKeySchema },
	({ organizationId, input: templateKey }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("emailTemplates.reset", () =>
				dbService.db
					.delete(organizationEmailTemplate)
					.where(
						and(
							eq(organizationEmailTemplate.organizationId, organizationId),
							eq(organizationEmailTemplate.templateKey, templateKey),
						),
					),
			);

			revalidateEmailTemplatePages();
			return undefined;
		}),
);

/** Sends the draft, filled with the template's preview data, to the caller; nothing is saved. */
export const sendEmailTemplateTest = organizationAction(
	{ name: "emailTemplates.sendTest", requires: "orgAdmin", schema: emailTemplateDraftSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const caller = yield* dbService.query("emailTemplates.sendTest.caller", () =>
				dbService.db.query.user.findFirst({
					where: eq(user.id, actor.userId),
					columns: { email: true },
				}),
			);
			if (!caller) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "User not found",
						entityType: "user",
						entityId: actor.userId,
					}),
				);
			}

			const { previewData } = getEmailTemplateDefinition(input.templateKey);
			const failed = (cause?: unknown) =>
				new ExternalServiceError({
					message: "Failed to send test email",
					service: "email",
					operation: "sendTemplateTest",
					cause,
				});
			const result = yield* Effect.tryPromise({
				try: () =>
					sendEmail({
						to: caller.email,
						organizationId,
						subject: interpolateTemplate(input.subject, previewData),
						html: interpolateTemplate(input.html, previewData),
					}),
				catch: failed,
			});
			if (!result.success) {
				return yield* Effect.fail(failed());
			}
			return undefined;
		}),
);
