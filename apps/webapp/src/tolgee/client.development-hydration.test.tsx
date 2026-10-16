/* @vitest-environment jsdom */

import { act } from "@testing-library/react";
import { useTranslate } from "@tolgee/react";
import { Suspense } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TolgeeNextProvider } from "./client";

vi.hoisted(() => vi.stubEnv("NODE_ENV", "development"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("hydrates delayed onboarding labels after the development provider mounts", async () => {
	let delayed = false;
	const ready = Promise.withResolvers<void>();
	const renders: string[][] = [];
	function Labels() {
		const { t } = useTranslate();
		if (delayed) throw ready.promise;
		const labels = [
			t("common:user.theme-toggle", "Toggle theme"),
			t("common:user.font-size", "Font size"),
		];
		renders.push(labels);
		return (
			<button type="button" aria-label={labels[0]}>
				<span>{labels[1]}</span>
			</button>
		);
	}
	const tree = (
		<TolgeeNextProvider
			slice={{
				locale: "en",
				namespaces: [],
				keyOwners: {},
				records: { en: {} },
			}}
		>
			<Suspense fallback={null}>
				<Labels />
			</Suspense>
		</TolgeeNextProvider>
	);
	const host = document.createElement("div");
	host.innerHTML = renderToString(tree);
	document.body.append(host);
	const button = host.querySelector("button");
	const errors: unknown[] = [];
	let root: ReturnType<typeof hydrateRoot> | undefined;
	try {
		delayed = true;
		await act(async () => {
			root = hydrateRoot(host, tree, {
				onRecoverableError: (error) => errors.push(error),
			});
		});
		// React can hydrate a Suspense subtree after the outer provider's effects.
		delayed = false;
		await act(async () => {
			ready.resolve();
		});
		expect(errors).toEqual([]);
		expect(host.querySelector("button")).toBe(button);
		expect(renders.length).toBeGreaterThan(1);
		expect(
			renders.every(
				(labels) => labels[0] === "Toggle theme" && labels[1] === "Font size",
			),
		).toBe(true);
	} finally {
		await act(async () => root?.unmount());
		host.remove();
		vi.unstubAllEnvs();
	}
});
