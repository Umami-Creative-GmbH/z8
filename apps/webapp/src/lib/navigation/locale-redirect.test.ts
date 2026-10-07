import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getLocale: vi.fn<() => Promise<string>>(),
}));

vi.mock("next-intl/server", () => ({
	getLocale: mockState.getLocale,
}));

import { redirectWithLocale } from "./locale-redirect";

async function redirectTarget(href: `/${string}`): Promise<string> {
	try {
		await redirectWithLocale(href);
	} catch (error) {
		const digest = (error as { digest?: unknown }).digest;

		if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
			return digest.split(";")[2] ?? "";
		}

		throw error;
	}

	throw new Error("redirectWithLocale returned without redirecting");
}

describe("redirectWithLocale", () => {
	beforeEach(() => {
		mockState.getLocale.mockReset();
	});

	it("keeps the request locale on the redirect target", async () => {
		mockState.getLocale.mockResolvedValue("en");

		await expect(redirectTarget("/settings")).resolves.toBe("/en/settings");
	});

	it("keeps a non-default request locale on nested targets", async () => {
		mockState.getLocale.mockResolvedValue("de");

		await expect(redirectTarget("/settings/employees")).resolves.toBe("/de/settings/employees");
	});

	it("sends the root to the bare locale home without a trailing slash", async () => {
		mockState.getLocale.mockResolvedValue("fr");

		await expect(redirectTarget("/")).resolves.toBe("/fr");
	});
});
