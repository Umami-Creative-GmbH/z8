import type { EmailTemplateVariableDefinition } from "./template-registry";

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

interface ValidateTemplateContentInput {
	subject: string;
	html: string;
	allowedVariables: EmailTemplateVariableDefinition[];
}

interface ValidateTemplateContentResult {
	success: boolean;
	errors: string[];
}

export function extractTemplateVariables(content: string): string[] {
	const variables: string[] = [];
	const seen = new Set<string>();

	for (const match of content.matchAll(PLACEHOLDER_PATTERN)) {
		const name = match[1];

		if (!seen.has(name)) {
			seen.add(name);
			variables.push(name);
		}
	}

	return variables;
}

export function validateTemplateContent({
	subject,
	html,
	allowedVariables,
}: ValidateTemplateContentInput): ValidateTemplateContentResult {
	const errors = new Set<string>();

	if (!subject.trim()) {
		errors.add("Subject is required");
	}

	if (subject.length > 180) {
		errors.add("Subject must be 180 characters or fewer");
	}

	if (!html.trim()) {
		errors.add("HTML body is required");
	}

	if (html.length > 200000) {
		errors.add("HTML body must be 200000 characters or fewer");
	}

	const combinedContent = `${subject}\n${html}`;
	const contentWithoutValidPlaceholders = combinedContent.replace(PLACEHOLDER_PATTERN, "");

	if (
		contentWithoutValidPlaceholders.includes("{{") ||
		contentWithoutValidPlaceholders.includes("}}")
	) {
		errors.add("Malformed variable placeholder syntax");
	}

	const allowedVariableNames = new Set(allowedVariables.map((variable) => variable.name));

	for (const variableName of extractTemplateVariables(combinedContent)) {
		if (!allowedVariableNames.has(variableName)) {
			errors.add(`Unknown variable: ${variableName}`);
		}
	}

	return {
		success: errors.size === 0,
		errors: Array.from(errors),
	};
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			default:
				return character;
		}
	});
}

export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
	return template.replace(PLACEHOLDER_PATTERN, (_placeholder, variableName: string) =>
		escapeHtml(stringifyTemplateValue(data[variableName])),
	);
}

export function sanitizeEmailHtml(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
		.replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/\s+(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, "");
}

function stringifyTemplateValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}

	if (Array.isArray(value)) {
		return value.map((item) => stringifyTemplateValue(item)).join(", ");
	}

	return String(value);
}
