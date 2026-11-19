/* @vitest-environment jsdom */

import { act } from "@testing-library/react";
import { Suspense } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider, SidebarTrigger } from "./sidebar";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", async () => {
	const { useSyncExternalStore } = await import("react");
	return {
		useIsMobile: () =>
			useSyncExternalStore(
				() => () => {},
				() => mobile.value,
				() => false,
			),
	};
});
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function DeferredNavigation({
	gate,
}: {
	gate: { blocked: boolean; pending: Promise<void> };
}) {
	if (gate.blocked) throw gate.pending;
	return (
		<>
			<SidebarTrigger />
			<Sidebar collapsible="icon">Calendar</Sidebar>
		</>
	);
}

it.each([false, true])(
	"hydrates delayed navigation without resetting a mounted draft (phone: %s)",
	async (phone) => {
		mobile.value = false;
		const storage = new Map([["sidebar_state", "false"]]);
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
			},
		});
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const gate = { blocked: false, pending };
		const shell = (
			<SidebarProvider>
				<Suspense fallback={<p>Loading navigation</p>}>
					<DeferredNavigation gate={gate} />
				</Suspense>
				<input aria-label="Draft" defaultValue="Retained context" />
			</SidebarProvider>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(shell);
		document.body.append(container);
		expect(
			container
				.querySelector("[data-slot=sidebar]")
				?.getAttribute("data-state"),
		).toBe("expanded");
		const draft = container.querySelector("input");
		let root: ReturnType<typeof hydrateRoot> | undefined;
		const recoverable: string[] = [];
		try {
			mobile.value = phone;
			gate.blocked = true;
			await act(async () => {
				root = hydrateRoot(container, shell, {
					onRecoverableError: (error) => recoverable.push(String(error)),
				});
			});
			await act(async () => {
				gate.blocked = false;
				release();
				await pending;
			});
			expect(recoverable).toEqual([]);
			if (!phone) {
				expect(
					container
						.querySelector("[data-slot=sidebar]")
						?.getAttribute("data-state"),
				).toBe("collapsed");
			} else {
				expect(
					container.querySelector("[data-slot=sidebar][data-state]"),
				).toBeNull();
			}
			expect(
				container.querySelector("button")?.getAttribute("aria-expanded"),
			).toBe("false");
			expect(container.querySelector("input")).toBe(draft);
			expect(draft?.value).toBe("Retained context");
		} finally {
			await act(async () => root?.unmount());
			container.remove();
		}
	},
);
