import type { EmailTemplateKey } from "@/db/schema";
import {
	type EmailTemplateDefinition,
	getEmailTemplateDefinition,
} from "@/lib/email/template-registry";
import { validateTemplateContent } from "@/lib/email/template-validation";

export interface SaveEmailTemplateInput {
	templateKey: EmailTemplateKey;
	subject: string;
	html: string;
	editorDocument: unknown;
	plainText?: string;
	isEnabled?: boolean;
}

export interface EmailTemplateActionResult {
	success: boolean;
	errors?: string[];
}

export interface EmailTemplateValidationResult {
	success: boolean;
	errors: string[];
}

export function validateEmailTemplateInput(
	input: SaveEmailTemplateInput,
): EmailTemplateValidationResult {
	const errors: string[] = [];
	let definition: EmailTemplateDefinition | null = null;

	try {
		definition = getEmailTemplateDefinition(input.templateKey);
	} catch {
		errors.push("Unknown email template");
	}

	if (typeof input.subject !== "string") {
		errors.push("Subject must be a string");
	}

	if (typeof input.html !== "string") {
		errors.push("HTML body must be a string");
	}

	if (
		typeof input.editorDocument !== "object" ||
		input.editorDocument === null ||
		Array.isArray(input.editorDocument)
	) {
		errors.push("Editor document must be an object");
	}

	if (input.plainText !== undefined && typeof input.plainText !== "string") {
		errors.push("Plain text body must be a string");
	}

	if (input.isEnabled !== undefined && typeof input.isEnabled !== "boolean") {
		errors.push("Enabled state must be a boolean");
	}

	if (
		definition &&
		typeof input.subject === "string" &&
		typeof input.html === "string" &&
		(input.plainText === undefined || typeof input.plainText === "string")
	) {
		const contentValidation = validateTemplateContent({
			subject: input.subject,
			html: input.plainText ? `${input.html}\n${input.plainText}` : input.html,
			allowedVariables: definition.variables,
		});

		errors.push(...contentValidation.errors);
	}

	return {
		success: errors.length === 0,
		errors,
	};
}
