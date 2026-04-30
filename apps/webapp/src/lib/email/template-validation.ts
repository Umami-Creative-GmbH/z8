import sanitizeHtml from "sanitize-html";
import type { EmailTemplateVariableDefinition } from "./template-registry";

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

const ALLOWED_EMAIL_HTML_TAGS = [
	"html",
	"body",
	"div",
	"p",
	"span",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"a",
	"img",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"small",
	"hr",
	"pre",
	"code",
	"blockquote",
];

const ALLOWED_EMAIL_HTML_ATTRIBUTES = {
	"*": ["class", "title", "role", "aria-label"],
	a: ["href", "target", "rel", "name"],
	body: ["bgcolor"],
	img: ["src", "alt", "width", "height", "title"],
	table: ["align", "bgcolor", "border", "cellpadding", "cellspacing", "role", "width"],
	tbody: ["align", "valign"],
	td: ["align", "bgcolor", "colspan", "height", "rowspan", "valign", "width"],
	tfoot: ["align", "valign"],
	th: ["align", "bgcolor", "colspan", "height", "rowspan", "scope", "valign", "width"],
	thead: ["align", "valign"],
	tr: ["align", "bgcolor", "valign"],
};

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
	return sanitizeHtml(html, {
		allowedTags: ALLOWED_EMAIL_HTML_TAGS,
		allowedAttributes: ALLOWED_EMAIL_HTML_ATTRIBUTES,
		allowedSchemes: ["http", "https", "mailto", "tel"],
		allowedSchemesAppliedToAttributes: ["href", "src"],
		allowProtocolRelative: false,
		disallowedTagsMode: "discard",
		nonTextTags: [
			"iframe",
			"math",
			"noembed",
			"noframes",
			"noscript",
			"script",
			"style",
			"svg",
			"textarea",
		],
	}).replace(/\s+\/>/g, ">");
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
