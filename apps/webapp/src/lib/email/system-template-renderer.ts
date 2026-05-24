import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getPlatformSystemEmailTemplateOverride } from "./system-template-overrides";
import { getPlatformSystemEmailTemplateDefinition } from "./system-template-registry";
import {
	interpolateTemplate,
	sanitizeEmailHtml,
	validateTemplateContent,
} from "./template-validation";

const logger = createLogger("PlatformSystemEmailTemplateRenderer");

export interface RenderPlatformSystemEmailTemplateInput {
	templateKey: PlatformSystemEmailTemplateKey;
	data: Record<string, unknown>;
}

export interface RenderedPlatformSystemEmailTemplate {
	subject: string;
	html: string;
	plainText?: string;
	usedOverride: boolean;
}

export interface SkippedPlatformSystemEmailTemplate {
	skipped: true;
	reason: "template-disabled";
}

export async function renderPlatformSystemEmailTemplate({
	templateKey,
	data,
}: RenderPlatformSystemEmailTemplateInput): Promise<
	RenderedPlatformSystemEmailTemplate | SkippedPlatformSystemEmailTemplate
> {
	const definition = getPlatformSystemEmailTemplateDefinition(templateKey);
	const defaultTemplate = async (): Promise<RenderedPlatformSystemEmailTemplate> => ({
		subject: interpolateTemplate(definition.defaultSubject, data),
		html: await definition.renderDefault(data as never),
		usedOverride: false,
	});

	let override;
	try {
		override = await getPlatformSystemEmailTemplateOverride(templateKey);
	} catch (error) {
		logger.warn(
			{ error, templateKey },
			"Failed to load platform system email template override, falling back to default",
		);
		return defaultTemplate();
	}

	if (!override) {
		return defaultTemplate();
	}

	if (!override.isEnabled) {
		return { skipped: true, reason: "template-disabled" };
	}

	const validation = validateTemplateContent({
		subject: override.subject,
		html: override.plainText ? `${override.html}\n${override.plainText}` : override.html,
		allowedVariables: definition.variables,
	});

	if (!validation.success) {
		logger.warn(
			{ errors: validation.errors, templateKey },
			"Invalid platform system email template override, falling back to default",
		);
		return defaultTemplate();
	}

	const html = sanitizeEmailHtml(interpolateTemplate(override.html, data));

	if (!html.trim()) {
		logger.warn(
			{ templateKey },
			"Platform system email template override rendered empty HTML, falling back to default",
		);
		return defaultTemplate();
	}

	return {
		subject: interpolateTemplate(override.subject, data),
		html,
		plainText: override.plainText ? interpolateTemplate(override.plainText, data) : undefined,
		usedOverride: true,
	};
}
