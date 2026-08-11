import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ServerInstanceOptions = {
	getLocale: () => Promise<string>;
	createTolgee: (language: string) => Promise<unknown>;
};

const mockState = vi.hoisted(() => ({
	createServerInstance: vi.fn(),
	getLocale: vi.fn(async () => "en"),
	init: vi.fn((options: unknown) => options),
	loadRouteTranslations: vi.fn(async (language: string) => ({ [language]: {} })),
	options: undefined as ServerInstanceOptions | undefined,
}));

vi.mock("@tolgee/react/server", () => ({
	createServerInstance: mockState.createServerInstance.mockImplementation(
		(options: ServerInstanceOptions) => {
			mockState.options = options;
			return { getTolgee: vi.fn(), getTranslate: vi.fn(), T: vi.fn() };
		},
	),
}));

vi.mock("next-intl/server", () => ({
	getLocale: mockState.getLocale,
}));

vi.mock("./load-translations", () => ({
	loadRouteTranslations: mockState.loadRouteTranslations,
}));

vi.mock("./shared", () => ({
	TolgeeBase: () => ({ init: mockState.init }),
}));

await import("./server");

beforeEach(() => {
	mockState.init.mockClear();
	mockState.loadRouteTranslations.mockClear();
});

describe("Tolgee server instance", () => {
	it("initializes each language from the shared cached translation loader", async () => {
		expect(mockState.createServerInstance).toHaveBeenCalledOnce();
		expect(mockState.options?.getLocale).toBe(mockState.getLocale);

		await mockState.options?.createTolgee("de");

		expect(mockState.loadRouteTranslations).toHaveBeenCalledOnce();
		expect(mockState.loadRouteTranslations).toHaveBeenCalledWith("de");
		expect(mockState.init).toHaveBeenCalledWith({
			observerOptions: { fullKeyEncode: false },
			language: "de",
			staticData: { de: {} },
		});
	});

	it("does not load or merge namespaces directly", () => {
		const source = readFileSync("src/tolgee/server.tsx", "utf8");

		expect(source).toContain('import { loadRouteTranslations } from "./load-translations";');
		expect(source).not.toContain("loadNamespaces");
		expect(source).not.toContain("ALL_NAMESPACES");
	});
});
