import { describe, expect, test } from "vitest";
import { EMAIL_TEMPLATE_KEYS } from "@/db/schema";
import { EMAIL_TEMPLATE_REGISTRY, getEmailTemplateDefinition } from "./template-registry";

describe("EMAIL_TEMPLATE_REGISTRY", () => {
	test("registers every email template key in schema order", () => {
		expect(EMAIL_TEMPLATE_REGISTRY.map((entry) => entry.key)).toEqual(EMAIL_TEMPLATE_KEYS);
	});

	test("defines complete defaults for every registered email template", async () => {
		for (const definition of EMAIL_TEMPLATE_REGISTRY) {
			expect(definition.defaultSubject).not.toHaveLength(0);
			expect(definition.label).not.toHaveLength(0);
			expect(definition.description).not.toHaveLength(0);
			expect(definition.variables.length).toBeGreaterThan(0);
			expect(definition.previewData).toEqual(expect.any(Object));

			await expect(definition.renderDefault(definition.previewData as never)).resolves.toContain(
				"<",
			);
		}
	});

	test("throws for unknown email template keys", () => {
		expect(() => getEmailTemplateDefinition("unknown" as never)).toThrow(
			"Unknown email template key",
		);
	});
});
