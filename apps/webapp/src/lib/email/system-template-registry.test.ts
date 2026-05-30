import { describe, expect, test } from "vitest";
import { PLATFORM_SYSTEM_EMAIL_TEMPLATE_KEYS } from "@/db/schema";
import {
	getPlatformSystemEmailTemplateDefinition,
	PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY,
} from "./system-template-registry";

describe("PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY", () => {
	test("registers every platform system email template key in schema order", () => {
		expect(PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY.map((entry) => entry.key)).toEqual(
			PLATFORM_SYSTEM_EMAIL_TEMPLATE_KEYS,
		);
	});

	test("throws for unknown platform system email template keys", () => {
		expect(() => getPlatformSystemEmailTemplateDefinition("unknown" as never)).toThrow(
			"Unknown platform system email template key",
		);
	});
});
