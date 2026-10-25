/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, waitFor } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import { DashboardHeaderCustomize } from "./dashboard-header-customize";
import type { DashboardLayoutBootstrap } from "./dashboard-types";

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "viewer",
		organizationId: "organization",
		role: "manager",
		isLoading: false,
	}),
}));
vi.mock("./actions", () => ({ updateWidgetOrder: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe("Dashboard header selective hydration", () => {
	it("hydrates the server header when a streamed sibling has already seeded its layout query", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const header = (
			<QueryClientProvider client={client}>
				<header>
					<button type="button">Clock in</button>
					<DashboardHeaderCustomize />
				</header>
			</QueryClientProvider>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(header);
		document.body.append(container);
		const clock = container.querySelector("button");
		const layout: DashboardLayoutBootstrap = {
			scope: { userId: "viewer", organizationId: "organization" },
			updatedAt: 1,
			settings: {
				dashboardWidgetOrder: {
					version: 1,
					order: ["quick-stats"],
					hidden: [],
				},
			},
			availableWidgetIds: ["quick-stats"],
		};
		client.setQueryData(
			queryKeys.dashboard.widgetOrder("viewer", "organization"),
			layout,
		);
		const recoverableError = vi.fn();
		let root: Root | undefined;
		try {
			await act(async () => {
				root = hydrateRoot(container, header, {
					onRecoverableError: recoverableError,
				});
			});
			expect(recoverableError).not.toHaveBeenCalled();
			expect(container.querySelector("button")).toBe(clock);
			await waitFor(() =>
				expect(
					container.querySelector('button[aria-label="Customize dashboard"]'),
				).not.toBeNull(),
			);
		} finally {
			await act(async () => root?.unmount());
			container.remove();
			client.clear();
		}
	});

	it("shows a later streamed layout without replacing the already hydrated clock", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const header = (
			<QueryClientProvider client={client}>
				<header>
					<button type="button">Clock in</button>
					<DashboardHeaderCustomize />
				</header>
			</QueryClientProvider>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(header);
		document.body.append(container);
		const clock = container.querySelector("button");
		const recoverableError = vi.fn();
		let root: Root | undefined;
		try {
			await act(async () => {
				root = hydrateRoot(container, header, {
					onRecoverableError: recoverableError,
				});
			});
			expect(
				container.querySelector('button[aria-label="Customize dashboard"]'),
			).toBeNull();
			const layout: DashboardLayoutBootstrap = {
				scope: { userId: "viewer", organizationId: "organization" },
				updatedAt: 1,
				settings: {
					dashboardWidgetOrder: {
						version: 1,
						order: ["quick-stats"],
						hidden: [],
					},
				},
				availableWidgetIds: ["quick-stats"],
			};
			await act(async () => {
				client.setQueryData(
					queryKeys.dashboard.widgetOrder("viewer", "organization"),
					layout,
				);
			});
			expect(recoverableError).not.toHaveBeenCalled();
			expect(container.querySelector("button")).toBe(clock);
			await waitFor(() =>
				expect(
					container.querySelector('button[aria-label="Customize dashboard"]'),
				).not.toBeNull(),
			);
		} finally {
			await act(async () => root?.unmount());
			container.remove();
			client.clear();
		}
	});
});
