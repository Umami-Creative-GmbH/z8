/* @vitest-environment jsdom */

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { QueryProvider } from "@/lib/query/provider";
import type { CatalogSlice } from "./catalog-slices";
import {
	applyCatalogRecords,
	getCatalogSlice,
	hasCatalogNamespaces,
	type TolgeeInstance,
} from "./catalog-store";
import { TolgeeNextProvider, useNamespaces } from "./client";
import { FeatureTranslationProvider } from "./feature-provider";
import {
	loadCatalogSlice,
	loadCompleteServerTranslations,
	loadShellTranslations,
} from "./load-translations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
	authClient: { organization: { create: vi.fn() } },
}));
vi.mock("@/app/[locale]/(app)/organization-actions", () => ({
	checkSlugAvailability: vi.fn(),
}));
afterEach(cleanup);

function Labels() {
	const { t } = useTranslate();
	return (
		<p>
			{t("nav.reports")}|{t("reports.title")}|{t("reports:reports.title")}|
			{t("organization.noEmployeeRecord")}|
			{t("organization.createDialog.title")}
		</p>
	);
}

describe("real Tolgee feature delivery", () => {
	it("translates the actual no-employee guard and its create-organization dialog with only shell records", async () => {
		const shell = await loadShellTranslations("de");
		render(
			<TolgeeNextProvider slice={shell}>
				<NoEmployeeError />
			</TolgeeNextProvider>,
		);
		expect(screen.getByText("Mitarbeiterprofil erforderlich")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Organisation erstellen" }),
		);
		expect(await screen.findByRole("dialog")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Organisation erstellen" }),
		).toBeTruthy();
		expect(document.body.textContent).not.toContain(
			"organization.createDialog",
		);
	});
	it("does not reveal an old-locale streamed feature under the destination root", async () => {
		const shell = await loadShellTranslations("tr");
		const old = await loadCatalogSlice("en", ["reports"]);
		const destination = await loadCatalogSlice("tr", ["reports"]);
		const view = render(
			<TolgeeNextProvider slice={shell}>
				<FeatureTranslationProvider slice={old}>
					<p>Feature visible</p>
				</FeatureTranslationProvider>
			</TolgeeNextProvider>,
		);
		expect(view.container.textContent).toBe("");
		view.rerender(
			<TolgeeNextProvider slice={shell}>
				<FeatureTranslationProvider slice={destination}>
					<p>Feature visible</p>
				</FeatureTranslationProvider>
			</TolgeeNextProvider>,
		);
		expect(view.container.textContent).toBe("Feature visible");
	});
	it("renders predecessor primary, alias and shared labels on SSR and hydration", async () => {
		const shell = await loadShellTranslations("de");
		const feature = await loadCatalogSlice("de", ["reports"]);
		const complete = await loadCompleteServerTranslations("de");
		const tree = (
			<TolgeeNextProvider slice={shell}>
				<FeatureTranslationProvider slice={feature}>
					<Labels />
				</FeatureTranslationProvider>
			</TolgeeNextProvider>
		);
		const markup = renderToString(tree);
		const predecessor = renderToString(
			<TolgeeNextProvider slice={{ ...shell, records: complete }}>
				<Labels />
			</TolgeeNextProvider>,
		);
		expect(markup).toBe(predecessor);
		expect(markup).not.toContain("reports.title");
		expect(markup).not.toContain("organization.noEmployeeRecord");
		expect(Buffer.byteLength(JSON.stringify(feature.records))).toBeLessThan(
			Buffer.byteLength(JSON.stringify(complete)),
		);
		const host = document.createElement("div");
		host.innerHTML = markup;
		const errors: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(host, tree, {
				onRecoverableError: (error) => errors.push(error),
			});
		});
		expect(host.innerHTML).toBe(markup);
		expect(errors).toEqual([]);
		await act(async () => root.unmount());
	});

	it("retains root running state, listeners, queries and cumulative slices through feature replacement and unmount", async () => {
		const shell = await loadShellTranslations("fr");
		const reports = await loadCatalogSlice("fr", ["reports"]);
		const calendar = await loadCatalogSlice("fr", ["calendar"]);
		const rules = await loadCatalogSlice("fr", ["settings/rules"]);
		const parent = await loadCatalogSlice("fr", ["settings/generic"]);
		let instance!: TolgeeInstance;
		let query!: QueryClient;
		function Capture() {
			const tolgee = useTolgee(["language"]);
			const client = useQueryClient();
			useEffect(() => {
				instance = tolgee;
				query = client;
			});
			return null;
		}
		function Tree({ feature }: { feature?: CatalogSlice }) {
			return (
				<TolgeeNextProvider slice={shell}>
					<QueryProvider>
						<Capture />
						<FeatureTranslationProvider slice={parent}>
							{feature && (
								<FeatureTranslationProvider
									key={feature.namespaces.join()}
									slice={feature}
								>
									<Labels />
								</FeatureTranslationProvider>
							)}
						</FeatureTranslationProvider>
					</QueryProvider>
				</TolgeeNextProvider>
			);
		}
		const view = render(<Tree feature={reports} />);
		await waitFor(() => expect(instance.isRunning()).toBe(true));
		const original = instance;
		const originalQuery = query;
		const owners = getCatalogSlice(original)?.keyOwners;

		const events = vi.fn();
		const subscription = original.on("cache", events);
		act(() => {
			applyCatalogRecords(original, rules);
		});
		view.rerender(<Tree feature={calendar} />);
		view.rerender(<Tree />);
		expect(instance).toBe(original);
		expect(query).toBe(originalQuery);
		expect(original.isRunning()).toBe(true);

		expect(
			hasCatalogNamespaces(original, ["reports", "calendar", "settings/rules"]),
		).toBe(true);
		expect(getCatalogSlice(original)?.namespaces).toEqual(
			expect.arrayContaining(["reports", "calendar", "settings/rules"]),
		);
		expect(getCatalogSlice(original)?.keyOwners).toEqual(owners);
		expect(original.t("reports:reports.title")).not.toBe(
			"reports:reports.title",
		);
		expect(original.t("calendar:absences.title")).not.toBe(
			"calendar:absences.title",
		);
		expect(
			original.t("settings/rules:settings.approvalPolicies.title"),
		).not.toBe("settings/rules:settings.approvalPolicies.title");
		events.mockClear();
		act(() => {
			applyCatalogRecords(original, { ...reports });
		});
		expect(events).toHaveBeenCalled();
		subscription.unsubscribe();
	});

	it("makes destination locale and a lazy cross-feature dialog ready before revealing labels", async () => {
		function Dialog() {
			const ready = useNamespaces(["travelExpenses"]);
			const { t } = useTranslate();
			return (
				<p>{ready.isLoaded ? t("travelExpenses.title") : "Loading dialog"}</p>
			);
		}
		const en = await loadShellTranslations("en");
		const es = await loadShellTranslations("es");
		const feature = await loadCatalogSlice("es", ["reports"]);
		const view = render(
			<TolgeeNextProvider slice={en}>
				<Dialog />
			</TolgeeNextProvider>,
		);
		view.rerender(
			<TolgeeNextProvider slice={es}>
				<FeatureTranslationProvider slice={feature}>
					<Labels />
					<Dialog />
				</FeatureTranslationProvider>
			</TolgeeNextProvider>,
		);
		expect(view.container.textContent).not.toContain("reports.title");
		await waitFor(() =>
			expect(view.container.textContent).not.toContain("Loading dialog"),
		);
		expect(view.container.textContent).not.toContain("travelExpenses.title");
	});
});
