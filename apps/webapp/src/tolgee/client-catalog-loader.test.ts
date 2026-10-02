import { describe, expect, it, vi } from "vitest";
import { loadClientCatalogSlice } from "./client-catalog-loader";
import {
	ALL_LANGUAGES,
	ALL_NAMESPACES,
	loadNamespaces,
	type Namespace,
} from "./shared";

vi.mock("./shared", async (original) => ({
	...(await original<typeof import("./shared")>()),
	loadNamespaces: vi.fn(),
}));

describe("selective client acquisition", () => {
	it("acquires only requested real catalog modules and registers no complete fallback", async () => {
		vi.resetModules();
		vi.doUnmock("./shared");
		const imported: string[] = [];
		const paths = ALL_NAMESPACES.flatMap((namespace) =>
			ALL_LANGUAGES.map(
				(locale) => `../../messages/${namespace}/${locale}.json`,
			),
		);
		for (const path of paths)
			vi.doMock(path, async (original) => {
				imported.push(path);
				if (path !== "../../messages/reports/en.json")
					throw new Error(`Unrelated catalog imported: ${path}`);
				return original();
			});
		try {
			const { loadClientCatalogSlice: realLoad } = await import(
				"./client-catalog-loader"
			);
			const { TolgeeBase } = await import("./shared");
			const slice = await realLoad("en", ["reports"]);
			expect(slice.records.en).toHaveProperty("reports");
			const instance = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
				language: "en",
				staticData: slice.records,
			});
			await instance.run();
			expect(instance.t("reports.title")).not.toBe("reports.title");
			expect(imported).toEqual(["../../messages/reports/en.json"]);
			expect(
				Object.values(instance.getInitialOptions().staticData ?? {}).some(
					(value) => typeof value === "function",
				),
			).toBe(false);
			instance.stop();
		} finally {
			for (const path of paths) vi.doUnmock(path);
		}
	});
	it("deduplicates canonical concurrent identities and retries failed loads", async () => {
		let resolve!: (value: { en: Record<string, never> }) => void;
		vi.mocked(loadNamespaces).mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const first = loadClientCatalogSlice("unsupported", [
			"reports",
			"common",
			"reports",
		]);
		const second = loadClientCatalogSlice("en", ["common", "reports"]);
		expect(first).toBe(second);
		expect(loadNamespaces).toHaveBeenCalledTimes(1);
		expect(loadNamespaces).toHaveBeenLastCalledWith(
			"en",
			["common", "reports"],
			{ strict: true },
		);
		resolve({ en: {} });
		await first;
		vi.mocked(loadNamespaces).mockRejectedValueOnce(new Error("import failed"));
		await expect(loadClientCatalogSlice("de", ["reports"])).rejects.toThrow(
			"import failed",
		);
		vi.mocked(loadNamespaces).mockResolvedValueOnce({
			de: { reports: { title: "Berichte" } },
		});
		expect(
			(await loadClientCatalogSlice("de", ["reports"])).namespaces,
		).toEqual(["reports"]);
		await expect(
			loadClientCatalogSlice("en", ["unknown" as Namespace]),
		).rejects.toThrow(/namespace/i);
		expect(loadNamespaces).toHaveBeenCalledTimes(3);
	});
});
