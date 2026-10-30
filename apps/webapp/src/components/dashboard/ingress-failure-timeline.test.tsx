/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	ingressFailureAlertSelector,
	installIngressFailureTimeline,
	readIngressFailureTimeline,
} from "../../../../../scripts/performance/ingress-failure-timeline.mjs";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params: Record<string, string> = {}) =>
			Object.entries(params).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, value),
				fallback,
			),
	}),
}));
vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn() }),
}));
vi.mock("@/navigation", () => ({ Link: "a" }));
vi.mock("@/stores/organization-settings-store", () => ({
	useShiftsEnabled: () => true,
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		role: "employee",
		isLoading: false,
	}),
}));

import { UpcomingShiftsWidget } from "./upcoming-shifts-widget";
import { WidgetLoading } from "./widget-loading";

afterEach(() => {
	Reflect.get(window, "__z8IngressFailureTimeline")?.stop?.();
	cleanup();
});

it("the unchanged ingress selector finds the real streamed error fallback and records live pending-to-alert changes", async () => {
	installIngressFailureTimeline();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(<WidgetLoading id="upcoming-shifts" />);
	await waitFor(() =>
		expect(
			readIngressFailureTimeline().events.some((event) => event.pending),
		).toBe(true),
	);
	view.rerender(
		<QueryClientProvider client={client}>
			<UpcomingShiftsWidget
				initialSnapshot={{
					scope: { userId: "user-a", organizationId: "org-a" },
					updatedAt: Date.now(),
					result: { success: false, error: "Protected test failure text" },
				}}
			/>
		</QueryClientProvider>,
	);
	expect(document.querySelector(ingressFailureAlertSelector)).toBe(
		screen.getByRole("alert"),
	);
	expect(
		screen.getByRole("button", { name: "Retry Upcoming Shifts" }),
	).toBeTruthy();
	await waitFor(() =>
		expect(
			readIngressFailureTimeline().events.some(
				(event) => event.alert && !event.pending,
			),
		).toBe(true),
	);
	const timeline = readIngressFailureTimeline();
	expect(timeline.overflow).toBe(false);
	expect(
		timeline.events.every(
			(event) => Number.isFinite(event.epochMs) && Number.isFinite(event.nowMs),
		),
	).toBe(true);
	expect(JSON.stringify(timeline)).not.toContain("Protected test failure text");
});
