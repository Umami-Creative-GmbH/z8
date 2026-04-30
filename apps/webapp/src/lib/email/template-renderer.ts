import type { EmailTemplateKey } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getEnabledOrganizationEmailTemplate } from "./template-overrides";
import { getEmailTemplateDefinition } from "./template-registry";
import {
	interpolateTemplate,
	sanitizeEmailHtml,
	validateTemplateContent,
} from "./template-validation";

const logger = createLogger("EmailTemplateRenderer");

export interface RenderOrganizationEmailTemplateInput {
	organizationId?: string;
	templateKey: EmailTemplateKey;
	data: Record<string, unknown>;
	subjectOverride?: string;
}

export interface RenderedOrganizationEmailTemplate {
	subject: string;
	html: string;
	plainText?: string;
	usedOverride: boolean;
}

export async function renderOrganizationEmailTemplate({
	organizationId,
	templateKey,
	data,
	subjectOverride,
}: RenderOrganizationEmailTemplateInput): Promise<RenderedOrganizationEmailTemplate> {
	const definition = getEmailTemplateDefinition(templateKey);
	const defaultTemplate = async (): Promise<RenderedOrganizationEmailTemplate> => ({
		subject: subjectOverride ?? interpolateTemplate(definition.defaultSubject, data),
		html: await definition.renderDefault(data as never),
		usedOverride: false,
	});

	if (!organizationId) {
		return defaultTemplate();
	}

	let override;
	try {
		override = await getEnabledOrganizationEmailTemplate(organizationId, templateKey);
	} catch (error) {
		logger.warn(
			{ error, organizationId, templateKey },
			"Failed to load organization email template override, falling back to default",
		);
		return defaultTemplate();
	}

	if (!override) {
		return defaultTemplate();
	}

	const validation = validateTemplateContent({
		subject: override.subject,
		html: override.plainText ? `${override.html}\n${override.plainText}` : override.html,
		allowedVariables: definition.variables,
	});

	if (!validation.success) {
		logger.warn(
			{ errors: validation.errors, organizationId, templateKey },
			"Invalid organization email template override, falling back to default",
		);
		return defaultTemplate();
	}

	return {
		subject: interpolateTemplate(override.subject, data),
		html: sanitizeEmailHtml(interpolateTemplate(override.html, data)),
		plainText: override.plainText ? interpolateTemplate(override.plainText, data) : undefined,
		usedOverride: true,
	};
}
