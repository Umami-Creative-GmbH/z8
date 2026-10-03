/* @vitest-environment jsdom */

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/lib/query/provider";
import type { CatalogSlice } from "./catalog-slices";
import {
	applyCatalogRecords,
	hasCatalogNamespaces,
	type TolgeeInstance,
} from "./catalog-store";
import { TolgeeNextProvider, useNamespaces } from "./client";
import { loadClientCatalogSlice } from "./client-catalog-loader";
import { loadCatalogSlice } from "./load-translations";
import { ALL_NAMESPACES, type Namespace } from "./shared";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("./client-catalog-loader", () => ({ loadClientCatalogSlice: vi.fn() }));
let current: TolgeeInstance;
function Probe({ namespaces = [] }: { namespaces?: Namespace[] }) {
	const instance = useTolgee();
	useEffect(() => {
		current = instance;
	});
	const { t } = useTranslate();
	const state = useNamespaces(namespaces);
	return (
		<>
			<span data-testid="ready">{JSON.stringify(state)}</span>
			<span>{state.isLoaded ? t("reports.title") : "Loading feature"}</span>
			<span>{t("settings.title")}</span>
		</>
	);
}
beforeEach(() => {
	refresh.mockClear();
	vi.mocked(loadClientCatalogSlice).mockReset();
});
afterEach(cleanup);
describe("TolgeeNextProvider with real Tolgee", () => {
	it("keeps the instance and cumulative dictionary during same-locale navigation", () => {
		let query: QueryClient | undefined;
		function QueryIdentity() {
			const instance = useQueryClient();
			useEffect(() => {
				query = instance;
			});
			return <Probe />;
		}
		const { rerender } = render(
			<TolgeeNextProvider
				slice={{
					locale: "en",
					namespaces: [],
					keyOwners: {},
					records: { en: { settings: { title: "Settings" } } },
				}}
			>
				<QueryProvider>
					<QueryIdentity />
				</QueryProvider>
			</TolgeeNextProvider>,
		);
		const instance = current;
		const queryInstance = query;
		expect(queryInstance).toBeDefined();
		rerender(
			<TolgeeNextProvider
				slice={{
					locale: "en",
					namespaces: [],
					keyOwners: {},
					records: { en: { reports: { title: "Reports" } } },
				}}
			>
				<QueryProvider>
					<QueryIdentity />
				</QueryProvider>
			</TolgeeNextProvider>,
		);
		expect(current).toBe(instance);
		expect(query).toBe(queryInstance);
		expect(screen.getByText("Settings")).toBeTruthy();
		expect(screen.getByText("Reports")).toBeTruthy();
		expect(refresh).not.toHaveBeenCalled();
		expect(
			Object.values(instance.getInitialOptions().staticData ?? {}).some(
				(value) => typeof value === "function",
			),
		).toBe(false);
	});
	it("shares readiness across real SSR wrapper and live instance objects", async () => {
		const observed: TolgeeInstance[] = [];
		function Capture() {
			observed.push(useTolgee());
			return null;
		}
		render(
			<TolgeeNextProvider
				slice={{
					locale: "es",
					namespaces: [],
					keyOwners: {},
					records: { es: {} },
				}}
			>
				<Capture />
			</TolgeeNextProvider>,
		);
		expect(observed[0]).not.toBe(observed.at(-1));
		const slice = await loadCatalogSlice("es", ["reports"]);
		act(() => {
			applyCatalogRecords(observed[0], slice);
		});
		expect(
			hasCatalogNamespaces(observed[observed.length - 1], ["reports"]),
		).toBe(true);
		expect(observed[observed.length - 1].t("reports.title")).not.toBe(
			"reports.title",
		);
	});
	it("preserves complete-root collision ownership after a smaller lazy slice", async () => {
		const slice = await loadCatalogSlice("el", ALL_NAMESPACES);
		const common = await loadCatalogSlice("el", ["common"]);
		render(
			<TolgeeNextProvider slice={slice}>
				<Probe />
			</TolgeeNextProvider>,
		);
		const initial = current.getRecord({ language: "el" })?.data["common.more"];
		act(() => {
			applyCatalogRecords(current, common);
		});
		expect(current.getRecord({ language: "el" })?.data["common.more"]).toBe(
			initial,
		);
	});
	it("gates lazy features until applied and ignores an obsolete locale resolution", async () => {
		let resolve!: (slice: CatalogSlice) => void;
		vi.mocked(loadClientCatalogSlice).mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const { rerender } = render(
			<TolgeeNextProvider
				slice={{
					locale: "fr",
					namespaces: [],
					keyOwners: {},
					records: { fr: {} },
				}}
			>
				<Probe namespaces={["reports"]} />
			</TolgeeNextProvider>,
		);
		expect(screen.getByText("Loading feature")).toBeTruthy();
		await waitFor(() =>
			expect(loadClientCatalogSlice).toHaveBeenCalledWith("fr", ["reports"]),
		);
		const previous = current;
		vi.mocked(loadClientCatalogSlice).mockRejectedValue(
			new Error("de import failed"),
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		rerender(
			<TolgeeNextProvider
				slice={{
					locale: "de",
					namespaces: [],
					keyOwners: {},
					records: { de: {} },
				}}
			>
				<Probe namespaces={["reports"]} />
			</TolgeeNextProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("ready").textContent).toBe(
				'{"isLoading":false,"isLoaded":false}',
			),
		);
		const destination = current;
		await act(async () => resolve(await loadCatalogSlice("fr", ["reports"])));
		expect(current).toBe(destination);
		expect(current).not.toBe(previous);
		expect(hasCatalogNamespaces(current, ["reports"])).toBe(false);
		expect(hasCatalogNamespaces(previous, ["reports"])).toBe(false);
		expect(destination.getRecord({ language: "fr" })).toBeUndefined();
		warn.mockRestore();
	});
	it("loads real lazy records before releasing the gate and retries on remount", async () => {
		const slice = await loadCatalogSlice("it", ["reports"]);
		vi.mocked(loadClientCatalogSlice).mockRejectedValue(new Error("offline"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const view = render(
			<TolgeeNextProvider
				slice={{
					locale: "it",
					namespaces: [],
					keyOwners: {},
					records: { it: {} },
				}}
			>
				<Probe namespaces={["reports"]} />
			</TolgeeNextProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("ready").textContent).toContain(
				'"isLoading":false',
			),
		);
		expect(hasCatalogNamespaces(current, ["reports"])).toBe(false);
		view.unmount();
		let resolve!: (slice: CatalogSlice) => void;
		vi.mocked(loadClientCatalogSlice).mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		render(
			<TolgeeNextProvider
				slice={{
					locale: "it",
					namespaces: [],
					keyOwners: {},
					records: { it: {} },
				}}
			>
				<Probe namespaces={["reports"]} />
			</TolgeeNextProvider>,
		);
		expect(screen.getByText("Loading feature")).toBeTruthy();
		await waitFor(() =>
			expect(loadClientCatalogSlice).toHaveBeenCalledWith("it", ["reports"]),
		);
		await act(async () => resolve(slice));
		expect(hasCatalogNamespaces(current, ["reports"])).toBe(true);
		expect(screen.getByTestId("ready").textContent).toBe(
			'{"isLoading":false,"isLoaded":true}',
		);
		expect(current.t("reports.title")).not.toBe("reports.title");
		expect(refresh).not.toHaveBeenCalled();
		warn.mockRestore();
	});
	it("resets loading when a failed namespace set is selected again", async () => {
		vi.mocked(loadClientCatalogSlice).mockRejectedValue(new Error("offline"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const records = { gsw: {} };
		const view = render(
			<TolgeeNextProvider
				slice={{
					locale: "gsw",
					namespaces: [],
					keyOwners: {},
					records: records,
				}}
			>
				<Probe namespaces={["reports"]} />
			</TolgeeNextProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("ready").textContent).toBe(
				'{"isLoading":false,"isLoaded":false}',
			),
		);
		view.rerender(
			<TolgeeNextProvider
				slice={{
					locale: "gsw",
					namespaces: [],
					keyOwners: {},
					records: records,
				}}
			>
				<Probe />
			</TolgeeNextProvider>,
		);
		vi.mocked(loadClientCatalogSlice).mockImplementation(
			() => new Promise(() => {}),
		);
		view.rerender(
			<TolgeeNextProvider
				slice={{
					locale: "gsw",
					namespaces: [],
					keyOwners: {},
					records: records,
				}}
			>
				<Probe namespaces={["reports"]} />
			</TolgeeNextProvider>,
		);
		expect(screen.getByTestId("ready").textContent).toBe(
			'{"isLoading":true,"isLoaded":false}',
		);
		warn.mockRestore();
	});
	it("guards nested catalog injection but refreshes once for an actual permanent edit", async () => {
		render(
			<TolgeeNextProvider
				slice={{
					locale: "pl",
					namespaces: [],
					keyOwners: {},
					records: { pl: { settings: { title: "Settings" } } },
				}}
			>
				<Probe />
			</TolgeeNextProvider>,
		);
		let permanentEdit!: () => void;
		let permanentEvent!: () => void;
		current.addPlugin((instance, tools) => {
			tools.setUi((ui) => {
				permanentEvent = () =>
					ui.onPermanentChange({
						language: "pl",
						namespace: "",
						key: "settings.title",
					});
				permanentEdit = () => {
					ui.changeTranslation({ language: "pl" }, "settings.title", "Edited");
					permanentEvent();
				};
				return { handleElementClick: async () => {} };
			});
			return instance;
		});
		const slice = await loadCatalogSlice("pl", ["reports"]);
		let injected = false;
		const sub = current.on("cache", () => {
			if (!injected) {
				injected = true;
				applyCatalogRecords(current, slice);
				permanentEvent();
			}
		});
		act(() => {
			applyCatalogRecords(current, slice);
		});
		sub.unsubscribe();
		expect(refresh).not.toHaveBeenCalled();
		act(() => permanentEdit());
		expect(current.t("settings.title")).toBe("Edited");
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
