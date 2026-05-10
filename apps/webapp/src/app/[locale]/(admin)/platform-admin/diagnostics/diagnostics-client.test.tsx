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

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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
		expect(screen.getByText("Healthy")).toBeTruthy();
		expect(screen.getByText("Billing")).toBeTruthy();
		expect(screen.getByText("Disabled")).toBeTruthy();
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
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

		await waitFor(() => expect(screen.getByText("Warning")).toBeTruthy());
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
