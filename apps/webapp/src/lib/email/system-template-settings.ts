import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import {
	getPlatformSystemEmailTemplateDefinition,
	type PlatformSystemEmailTemplateDefinition,
} from "@/lib/email/system-template-registry";
import { validateTemplateContent } from "@/lib/email/template-validation";

export interface SavePlatformSystemEmailTemplateInput {
	templateKey: PlatformSystemEmailTemplateKey;
	subject: string;
	html: string;
	editorDocument: unknown;
	plainText?: string;
	isEnabled?: boolean;
}

export interface PlatformSystemEmailTemplateActionResult {
	success: boolean;
	errors?: string[];
}

export interface PlatformSystemEmailTemplateValidationResult {
	success: boolean;
	errors: string[];
}

export function validatePlatformSystemEmailTemplateInput(
	input: unknown,
): PlatformSystemEmailTemplateValidationResult {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { success: false, errors: ["Template input must be an object"] };
	}

	const templateInput = input as Partial<SavePlatformSystemEmailTemplateInput>;
	const errors: string[] = [];
	let definition: PlatformSystemEmailTemplateDefinition | null = null;

	try {
		definition = getPlatformSystemEmailTemplateDefinition(
			templateInput.templateKey as PlatformSystemEmailTemplateKey,
		);
	} catch {
		errors.push("Unknown platform system email template");
	}

	if (typeof templateInput.subject !== "string") {
		errors.push("Subject must be a string");
	}

	if (typeof templateInput.html !== "string") {
		errors.push("HTML body must be a string");
	}

	if (
		typeof templateInput.editorDocument !== "object" ||
		templateInput.editorDocument === null ||
		Array.isArray(templateInput.editorDocument)
	) {
		errors.push("Editor document must be an object");
	}

	if (templateInput.plainText !== undefined && typeof templateInput.plainText !== "string") {
		errors.push("Plain text body must be a string");
	}

	if (templateInput.isEnabled !== undefined && typeof templateInput.isEnabled !== "boolean") {
		errors.push("Enabled state must be a boolean");
	}

	if (
		definition &&
		typeof templateInput.subject === "string" &&
		typeof templateInput.html === "string" &&
		(templateInput.plainText === undefined || typeof templateInput.plainText === "string")
	) {
		const contentValidation = validateTemplateContent({
			subject: templateInput.subject,
			html: templateInput.plainText
				? `${templateInput.html}\n${templateInput.plainText}`
				: templateInput.html,
			allowedVariables: definition.variables,
		});

		errors.push(...contentValidation.errors);
	}

	return {
		success: errors.length === 0,
		errors,
	};
}
