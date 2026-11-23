import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	redirectWithLocale: vi.fn((href: string) => {
		throw new Error(`REDIRECT:${href}`);
	}),
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));

import WorkSchedulePage from "./page";

describe("WorkSchedulePage retired route stub", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("redirects direct visits to the onboarding index route", async () => {
		await expect(WorkSchedulePage()).rejects.toThrow("REDIRECT:/onboarding");
		expect(mocks.redirectWithLocale).toHaveBeenCalledWith("/onboarding");
	});
});
