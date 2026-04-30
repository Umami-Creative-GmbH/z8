import { describe, expect, it } from "vitest";
import {
	escapeHtml,
	extractTemplateVariables,
	interpolateTemplate,
	sanitizeEmailHtml,
	validateTemplateContent,
} from "./template-validation";

const allowedVariables = [
	{ name: "employeeName", label: "Employee", description: "Employee name", example: "Alex" },
	{
		name: "approvalUrl",
		label: "Approval URL",
		description: "Approval URL",
		example: "https://example.com",
	},
];

describe("email template validation", () => {
	it("extracts variables from subject and body", () => {
		expect(extractTemplateVariables("Hi {{employeeName}}, open {{approvalUrl}}")).toEqual([
			"employeeName",
			"approvalUrl",
		]);
	});

	it("rejects unknown variables", () => {
		const result = validateTemplateContent({
			subject: "Hi {{employeeName}}",
			html: "<p>{{secretToken}}</p>",
			allowedVariables,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Unknown variable: secretToken");
	});

	it("rejects malformed variable syntax", () => {
		const result = validateTemplateContent({
			subject: "Hi {{employeeName}",
			html: "<p>Body</p>",
			allowedVariables,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Malformed variable placeholder syntax");
	});

	it("escapes interpolated values", () => {
		expect(escapeHtml('<script>alert("x")</script>')).toBe(
			"&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
		);
	});

	it("interpolates arrays as comma-separated escaped values", () => {
		expect(interpolateTemplate("Categories: {{categories}}", { categories: ["A", "B<script>"] })).toBe(
			"Categories: A, B&lt;script&gt;",
		);
	});

	it("removes executable html before storage or send", () => {
		expect(
			sanitizeEmailHtml(
				'<p onclick="alert(1)">Hi</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
			),
		).toBe('<p>Hi</p><img src="x">');
	});
});
