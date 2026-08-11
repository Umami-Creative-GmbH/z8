import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	cacheLife: vi.fn(),
	loadNamespaces: vi.fn(async () => ({ en: {} })),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
	cacheLife: mockState.cacheLife,
}));

vi.mock("./shared", () => ({
	ALL_NAMESPACES: ["common", "dashboard"],
	loadNamespaces: mockState.loadNamespaces,
}));

import { loadRouteTranslations } from "./load-translations";

beforeEach(() => {
	mockState.cacheLife.mockClear();
	mockState.loadNamespaces.mockClear();
});

describe("loadRouteTranslations", () => {
	it("strictly loads every namespace into the locale cache", async () => {
		await loadRouteTranslations("en");

		expect(mockState.cacheLife).toHaveBeenCalledWith("max");
		expect(mockState.loadNamespaces).toHaveBeenCalledWith(
			"en",
			["common", "dashboard"],
			{ strict: true },
		);
	});
});
