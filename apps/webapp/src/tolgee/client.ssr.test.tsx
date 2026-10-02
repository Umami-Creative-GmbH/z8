import { useTolgee, useTranslate } from "@tolgee/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	applyCatalogRecords,
	hasCatalogNamespaces,
	type TolgeeInstance,
} from "./catalog-store";
import { TolgeeNextProvider } from "./client";
import { loadCatalogSlice } from "./load-translations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

describe("render-local SSR catalogs", () => {
	it("accepts the existing root's empty prerender fallback records", () => {
		function Content() {
			const { t } = useTranslate();
			return <p>{t("settings.title", "Settings fallback")}</p>;
		}
		expect(
			renderToString(
				<TolgeeNextProvider language="en" staticData={{}}>
					<Content />
				</TolgeeNextProvider>,
			),
		).toBe("<p>Settings fallback</p>");
	});
	it("renders real translations immediately and isolates two same-locale server renders", async () => {
		const captured: TolgeeInstance[] = [];
		function Content() {
			captured.push(useTolgee());
			const { t } = useTranslate();
			return <p>{t("settings.title")}</p>;
		}
		const first = renderToString(
			<TolgeeNextProvider
				language="en"
				staticData={{ en: { settings: { title: "First render" } } }}
			>
				<Content />
			</TolgeeNextProvider>,
		);
		const second = renderToString(
			<TolgeeNextProvider
				language="en"
				staticData={{ en: { settings: { title: "Second render" } } }}
			>
				<Content />
			</TolgeeNextProvider>,
		);
		expect(first).toBe("<p>First render</p>");
		expect(second).toBe("<p>Second render</p>");
		applyCatalogRecords(captured[0], await loadCatalogSlice("en", ["reports"]));
		expect(hasCatalogNamespaces(captured[0], ["reports"])).toBe(true);
		expect(hasCatalogNamespaces(captured[1], ["reports"])).toBe(false);
		expect(
			captured[1].getRecord({ language: "en" })?.data["reports.title"],
		).toBeUndefined();
		expect(captured[0].t("settings.title")).toBe("First render");
		expect(captured[1].t("settings.title")).toBe("Second render");
	});
});
