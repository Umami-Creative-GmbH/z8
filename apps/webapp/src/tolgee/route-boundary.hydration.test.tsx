/* @vitest-environment jsdom */

import { act } from "@testing-library/react";
import { TolgeeProvider, useTolgee, useTranslate } from "@tolgee/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { getCatalogSlice, type TolgeeInstance } from "./catalog-store";
import { TolgeeNextProvider } from "./client";
import { loadClientCatalogSlice } from "./client-catalog-loader";
import { FeatureTranslationProvider } from "./feature-provider";
import {
	loadCatalogSlice,
	loadCompleteServerTranslations,
	loadShellTranslations,
} from "./load-translations";
import { TolgeeBase } from "./shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("./client-catalog-loader", () => ({ loadClientCatalogSlice: vi.fn() }));

// Vitest's per-file module isolation gives this test a fresh browser registry.
// Expected server markup never renders through that registry.
it("hydrates primary, alias and shared labels on a cold client with only shell and feature records", async () => {
	const shell = await loadShellTranslations("de");
	const feature = await loadCatalogSlice("de", ["reports"]);
	const complete = await loadCompleteServerTranslations("de");
	const server = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
		language: "de",
		staticData: complete,
	});
	const renders: string[][] = [];
	function Labels({ capture = false }: { capture?: boolean }) {
		const { t } = useTranslate();
		const labels = [
			t("nav.reports"),
			t("reports.title"),
			t("reports:reports.title"),
			t("organization.noEmployeeRecord"),
			t("organization.createDialog.title"),
		];
		if (capture) renders.push(labels);
		return <p>{labels.join("|")}</p>;
	}
	const markup = renderToString(
		<TolgeeProvider
			tolgee={server}
			ssr={{ language: "de", staticData: complete }}
		>
			<Labels />
		</TolgeeProvider>,
	);
	const expected = [
		"Berichte",
		"Mitarbeiterberichte",
		"Mitarbeiterberichte",
		"Sie sind in dieser Organisation noch nicht als Mitarbeiter eingerichtet.",
		"Organisation erstellen",
	];
	let client: TolgeeInstance | undefined;
	let initialRecords: ReturnType<typeof getCatalogSlice>;
	let initialReport: unknown;
	function CaptureShell() {
		const instance = useTolgee();
		if (!client) {
			client = instance;
			initialRecords = getCatalogSlice(instance);
			initialReport = instance.getRecord({ language: "de" })?.data[
				"reports.title"
			];
		}
		return null;
	}
	const host = document.createElement("div");
	host.innerHTML = markup;
	const errors: unknown[] = [];
	let root: ReturnType<typeof hydrateRoot> | undefined;
	try {
		await act(async () => {
			root = hydrateRoot(
				host,
				<TolgeeNextProvider slice={shell}>
					<CaptureShell />
					<FeatureTranslationProvider slice={feature}>
						<Labels capture />
					</FeatureTranslationProvider>
				</TolgeeNextProvider>,
				{ onRecoverableError: (error) => errors.push(error) },
			);
		});
		if (!client)
			throw new Error("Hydration did not render the client provider");
		expect(client).not.toBe(server);
		expect(initialRecords?.records.de).not.toHaveProperty("reports.title");
		expect(initialRecords?.namespaces).toEqual([]);
		expect(initialReport).toBeUndefined();
		expect(renders[0]).toEqual(expected);
		expect(host.innerHTML).toBe(markup);
		expect(errors).toEqual([]);
		expect(getCatalogSlice(client)?.namespaces).toEqual(["reports"]);
		expect(
			server.getRecord({ language: "de" })?.data["travelExpenses.title"],
		).toBeTruthy();
		expect(
			client?.getRecord({ language: "de" })?.data["travelExpenses.title"],
		).toBeUndefined();
		expect(loadClientCatalogSlice).not.toHaveBeenCalled();
		expect(
			Buffer.byteLength(JSON.stringify(getCatalogSlice(client)?.records)),
		).toBeLessThan(Buffer.byteLength(JSON.stringify(complete)));
	} finally {
		await act(async () => root?.unmount());
	}
});
