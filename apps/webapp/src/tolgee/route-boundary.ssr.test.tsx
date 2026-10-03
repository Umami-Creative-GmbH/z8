import { useTranslate } from "@tolgee/react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TolgeeNextProvider } from "./client";
import { FeatureTranslationProvider } from "./feature-provider";
import { loadCatalogSlice, loadShellTranslations } from "./load-translations";
import { RouteTranslationBoundary } from "./route-boundary";
import { ALL_LANGUAGES, ALL_NAMESPACES, type Namespace } from "./shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("./load-translations", async (original) => {
	const module = await original<typeof import("./load-translations")>();
	return { ...module, loadCatalogSlice: vi.fn(module.loadCatalogSlice) };
});

describe("render-local feature SSR", () => {
	it.each(ALL_LANGUAGES)(
		"renders recovery, report projects and nested settings wording immediately in %s",
		async (locale) => {
			const shell = await loadShellTranslations(locale);
			const complete = await loadCatalogSlice(locale, ALL_NAMESPACES);
			const examples: { namespaces: Namespace[]; key: string }[] = [
				{ namespaces: ["common", "billing"], key: "billing.suspended.title" },
				{ namespaces: ["reports"], key: "reports.projects.title" },
				{
					namespaces: ["settings/generic", "settings/rules"],
					key: "settings/rules:settings.approvalPolicies.title",
				},
			];
			function DynamicLabel({ translationKey }: { translationKey: string }) {
				const { t } = useTranslate();
				return (
					<p>
						{t(translationKey)}|{t(`errors.noEmployee.${"title"}`)}|
						{t(`organization.createDialog.${"title"}`)}
					</p>
				);
			}
			for (const example of examples) {
				const slice = await loadCatalogSlice(locale, example.namespaces);
				const markup = renderToString(
					<TolgeeNextProvider slice={shell}>
						<FeatureTranslationProvider slice={slice}>
							<DynamicLabel translationKey={example.key} />
						</FeatureTranslationProvider>
					</TolgeeNextProvider>,
				);
				const expected = renderToString(
					<TolgeeNextProvider slice={complete}>
						<DynamicLabel translationKey={example.key} />
					</TolgeeNextProvider>,
				);
				expect(markup).toBe(expected);
				expect(markup).not.toContain(example.key);
			}
		},
	);

	it("streams the shared header while withholding a feature until its catalog resolves", async () => {
		const shell = await loadShellTranslations("de");
		const feature = await loadCatalogSlice("de", ["common", "reports"]);
		let resolve!: (value: typeof feature) => void;
		vi.mocked(loadCatalogSlice).mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		function Label({ translationKey }: { translationKey: string }) {
			const { t } = useTranslate();
			return <p>{t(translationKey)}</p>;
		}
		const stream = await renderToReadableStream(
			<html lang="de">
				<body>
					<TolgeeNextProvider slice={shell}>
						<Label translationKey="nav.reports" />
						<RouteTranslationBoundary
							route="/reports"
							params={Promise.resolve({ locale: "de" })}
						>
							<Label translationKey="reports.title" />
						</RouteTranslationBoundary>
					</TolgeeNextProvider>
				</body>
			</html>,
		);
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		const first = decoder.decode((await reader.read()).value);
		expect(first).not.toContain("reports.title");
		expect(first).toContain("<!--$?");
		resolve(feature);
		let output = first;
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			output += decoder.decode(next.value);
		}
		expect(output).toContain("Berichte");
		expect(output).not.toContain("reports.title");
	});
});
