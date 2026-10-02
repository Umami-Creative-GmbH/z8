import type { TolgeeStaticData } from "@tolgee/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Namespace } from "./shared";

const mockState = vi.hoisted(() => ({
	cacheLife: vi.fn(),
	loadNamespaces: vi.fn<
		(
			locale: string,
			namespaces: readonly Namespace[],
			options?: { strict?: boolean },
		) => Promise<TolgeeStaticData>
	>(async () => ({ en: {} })),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
	cacheLife: mockState.cacheLife,
}));

vi.mock("./shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("./shared")>()),
	ALL_NAMESPACES: ["common", "dashboard"],
	loadNamespaces: mockState.loadNamespaces,
}));

import {
	loadCatalogSlice,
	loadRouteTranslations,
	loadShellTranslations,
} from "./load-translations";

beforeEach(() => {
	mockState.cacheLife.mockClear();
	mockState.loadNamespaces.mockReset();
	mockState.loadNamespaces.mockResolvedValue({ en: {} });
});

describe("loadRouteTranslations", () => {
	it("rejects unsupported namespaces before any cache or import", async () => {
		await expect(
			loadCatalogSlice("en", ["missing" as Namespace]),
		).rejects.toThrow(/namespace/i);
		expect(mockState.cacheLife).not.toHaveBeenCalled();
		expect(mockState.loadNamespaces).not.toHaveBeenCalled();
	});
	it("propagates strict import failures for complete, feature and shell loads", async () => {
		mockState.loadNamespaces.mockRejectedValue(
			new Error("catalog unavailable"),
		);
		await expect(loadRouteTranslations("en")).rejects.toThrow(
			"catalog unavailable",
		);
		await expect(loadCatalogSlice("en", ["dashboard"])).rejects.toThrow(
			"catalog unavailable",
		);
		await expect(loadShellTranslations("en")).rejects.toThrow(
			"catalog unavailable",
		);
	});
	it("encodes collision ownership without conflating literal dots/colons with nested paths", async () => {
		mockState.loadNamespaces.mockImplementation(
			async (_locale, namespaces) => ({
				en: {
					"a.b": namespaces[0],
					a: { b: namespaces[0] },
					"a:b": namespaces[0],
					...(namespaces[0] === "dashboard"
						? { unique: "only dashboard" }
						: {}),
				},
			}),
		);
		const slice = await loadCatalogSlice("unsupported", ["dashboard"]);
		expect(slice.locale).toBe("en");
		expect(slice.keyOwners).toEqual({
			'["a.b"]': "dashboard",
			'["a","b"]': "dashboard",
			'["a:b"]': "dashboard",
		});
		expect(mockState.loadNamespaces).toHaveBeenCalledWith("en", ["dashboard"], {
			strict: true,
		});
	});
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
