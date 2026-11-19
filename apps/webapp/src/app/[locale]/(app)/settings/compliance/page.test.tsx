import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	translate: vi.fn((key: string, fallback?: string) => `${key}|${fallback ?? ""}`),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => mocks.translate),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(),
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: vi.fn(),
}));
vi.mock("@/components/settings/compliance-exceptions-manager", () => ({
	ComplianceExceptionsManager: () => null,
}));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => null,
}));

import { generateMetadata } from "./page";

describe("compliance settings metadata", () => {
	beforeEach(() => vi.clearAllMocks());

	it("translates the page title and description", async () => {
		const metadata = await generateMetadata();

		expect(metadata).toEqual({
			title: "settings.compliance.metadata.title|Compliance Settings | ArbZG",
			description:
				"settings.compliance.metadata.description|Configure ArbZG compliance settings and manage exception requests",
		});
		expect(mocks.translate).toHaveBeenCalledTimes(2);
	});
});
