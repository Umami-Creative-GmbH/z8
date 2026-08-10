import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as diagnosticsPageModule from "./page";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

const mocks = vi.hoisted(() => ({
	collectPlatformDiagnostics: vi.fn(),
	requirePlatformAdmin: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { PlatformAdminService } = await import(
		"@/lib/effect/services/platform-admin.service"
	);

	return {
		AppLayer: Layer.succeed(PlatformAdminService, {
			requirePlatformAdmin: mocks.requirePlatformAdmin,
		} as never),
	};
});

vi.mock("@/lib/platform-diagnostics", () => ({
	collectPlatformDiagnostics: mocks.collectPlatformDiagnostics,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(),
}));

vi.mock("./diagnostics-client", () => ({
	DiagnosticsClient: vi.fn(),
}));

describe("PlatformDiagnosticsPageContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not collect protected diagnostics when platform-admin authorization fails", async () => {
		const authorizationError = new Error("redirect");
		mocks.requirePlatformAdmin.mockReturnValue(Effect.fail(authorizationError));
		const content = Reflect.get(
			diagnosticsPageModule,
			"PlatformDiagnosticsPageContent",
		);

		expect(content).toEqual(expect.any(Function));
		if (typeof content !== "function") return;

		await expect(content()).rejects.toThrow("redirect");
		expect(mocks.collectPlatformDiagnostics).not.toHaveBeenCalled();
	});
});

describe("PlatformDiagnosticsPageLoading", () => {
	it("mirrors the full-width overview before the two-card diagnostics grid", () => {
		const fallbackStart = pageSource.indexOf(
			"function PlatformDiagnosticsPageLoading",
		);
		const fallbackSource = pageSource.slice(fallbackStart);
		const overviewIndex = fallbackSource.search(
			/<div className="space-y-6">\s*<Card>\s*<CardHeader/,
		);
		const gridIndex = fallbackSource.indexOf(
			'<div className="grid gap-6 xl:grid-cols-2">',
		);

		expect(fallbackSource).toContain('className="space-y-10"');
		expect(fallbackSource).toContain('role="status"');
		expect(fallbackSource).toContain(
			'aria-label="Loading deployment diagnostics"',
		);
		expect(overviewIndex).toBeGreaterThanOrEqual(0);
		expect(gridIndex).toBeGreaterThan(overviewIndex);
	});
});
