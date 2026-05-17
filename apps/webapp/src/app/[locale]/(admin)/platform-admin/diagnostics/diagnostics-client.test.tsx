/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";

const { refreshPlatformDiagnosticsActionMock } = vi.hoisted(() => ({
	refreshPlatformDiagnosticsActionMock: vi.fn(),
}));

vi.mock("./actions", () => ({
	refreshPlatformDiagnosticsAction: refreshPlatformDiagnosticsActionMock,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string>) => {
			let value = defaultValue ?? _key;
			for (const [param, replacement] of Object.entries(params ?? {})) {
				value = value.replace(`{${param}}`, replacement);
			}
			return value;
		},
	}),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <section {...props}>{children}</section>,
	CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
	CardDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
	CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <header {...props}>{children}</header>,
	CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

function snapshot(overrides: Partial<PlatformDiagnosticsSnapshot> = {}): PlatformDiagnosticsSnapshot {
	return {
		fetchedAt: "2026-05-10T12:00:00.000Z",
		overallStatus: "healthy",
		configuration: [
			{
				title: "Billing",
				status: "disabled",
				value: "Disabled",
				description: "Runtime value of BILLING_ENABLED.",
			},
		],
		health: [
			{
				title: "Database",
				status: "healthy",
				value: "Connected",
				description: "Lightweight read against system configuration storage.",
			},
		],
		recommendedActions: [],
		...overrides,
	};
}

import { DiagnosticsClient } from "./diagnostics-client";

describe("DiagnosticsClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the initial diagnostics snapshot", () => {
		render(<DiagnosticsClient initialSnapshot={snapshot()} />);

		expect(screen.getByText("Deployment Diagnostics")).toBeTruthy();
		expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
		expect(screen.getByText("Billing")).toBeTruthy();
		expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("keeps item status labels accessible when the visual label is hidden", () => {
		const { container } = render(<DiagnosticsClient initialSnapshot={snapshot()} />);

		const hiddenStatusLabels = Array.from(container.querySelectorAll(".sr-only")).map((element) => element.textContent);

		expect(hiddenStatusLabels).toContain("Disabled");
		expect(hiddenStatusLabels).toContain("Healthy");
	});

	it("refreshes the snapshot when the refresh action succeeds", async () => {
		refreshPlatformDiagnosticsActionMock.mockResolvedValue({
			success: true,
			data: snapshot({
				fetchedAt: "2026-05-10T12:05:00.000Z",
				overallStatus: "warning",
				recommendedActions: ["Check Valkey/Redis connectivity and worker queue configuration."],
				health: [
					{
						title: "Queue / Valkey",
						status: "warning",
						value: "Unavailable",
						description: "BullMQ queue connectivity check.",
					},
				],
			}),
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh diagnostics" }));

		await waitFor(() => expect(screen.getAllByText("Warning").length).toBeGreaterThan(0));
		expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
		expect(screen.getByRole("status").textContent).toContain("Warning");
		expect(screen.getByRole("status").textContent).toContain("2026-05-10T12:05:00.000Z");
		expect(screen.getByText("Queue / Valkey")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
		expect(screen.getByText("Check Valkey/Redis connectivity and worker queue configuration.")).toBeTruthy();
	});

	it("keeps the previous snapshot visible when refresh fails", async () => {
		refreshPlatformDiagnosticsActionMock.mockResolvedValue({
			success: false,
			error: "Platform admin access required",
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh diagnostics" }));

		await waitFor(() => expect(screen.getByText("Platform admin access required")).toBeTruthy());
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
	});
});
