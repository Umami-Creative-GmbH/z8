import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as diagnosticsPageModule from "./page";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

const mocks = vi.hoisted(() => ({
	collectPlatformDiagnostics: vi.fn(),
	connection: vi.fn(),
	getTranslate: vi.fn(),
	operationOrder: [] as string[],
	requirePlatformAdmin: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: mocks.connection,
}));

vi.mock("@/lib/effect/services/platform-admin.service", () => ({
	requirePlatformAdmin: mocks.requirePlatformAdmin,
}));

vi.mock("@/lib/platform-diagnostics", () => ({
	collectPlatformDiagnostics: mocks.collectPlatformDiagnostics,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: mocks.getTranslate,
}));

vi.mock("./diagnostics-client", () => ({
	DiagnosticsClient: vi.fn(),
}));

describe("PlatformDiagnosticsPageContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.operationOrder.length = 0;
	});

	it("does not collect protected diagnostics when platform-admin authorization fails", async () => {
		const authorizationError = new Error("redirect");
		mocks.requirePlatformAdmin.mockRejectedValue(authorizationError);
		const content = Reflect.get(
			diagnosticsPageModule,
			"PlatformDiagnosticsPageContent",
		);

		expect(content).toEqual(expect.any(Function));
		if (typeof content !== "function") return;

		await expect(content()).rejects.toThrow("redirect");
		expect(mocks.connection).not.toHaveBeenCalled();
		expect(mocks.collectPlatformDiagnostics).not.toHaveBeenCalled();
	});

	it("enters the request boundary after authorization and before diagnostics collection", async () => {
		mocks.requirePlatformAdmin.mockImplementation(async () => {
			mocks.operationOrder.push("authorize");
			return { email: "admin@example.com" };
		});
		mocks.connection.mockImplementation(async () => {
			mocks.operationOrder.push("connection");
		});
		mocks.collectPlatformDiagnostics.mockImplementation(async () => {
			mocks.operationOrder.push("collect");
			return {};
		});
		mocks.getTranslate.mockResolvedValue(
			(_key: string, fallback: string) => fallback,
		);
		const content = Reflect.get(
			diagnosticsPageModule,
			"PlatformDiagnosticsPageContent",
		);

		expect(content).toEqual(expect.any(Function));
		if (typeof content !== "function") return;

		await content();

		expect(mocks.operationOrder).toEqual([
			"authorize",
			"connection",
			"collect",
		]);
	});

	it("authorizes without entering the Effect runtime before the request boundary", () => {
		const authorizationIndex = pageSource.indexOf(
			"const admin = await requirePlatformAdmin();",
		);
		const connectionIndex = pageSource.indexOf("await connection();");
		const collectionIndex = pageSource.indexOf("collectPlatformDiagnostics()");

		expect(pageSource).not.toContain("Effect.runPromise");
		expect(authorizationIndex).toBeGreaterThanOrEqual(0);
		expect(connectionIndex).toBeGreaterThan(authorizationIndex);
		expect(collectionIndex).toBeGreaterThan(connectionIndex);
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
