/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";

const {
	refreshPlatformDiagnosticsActionMock,
	testPlatformKeyManagerEncryptionActionMock,
	sendPlatformDiagnosticsTestEmailActionMock,
} = vi.hoisted(() => ({
	refreshPlatformDiagnosticsActionMock: vi.fn(),
	testPlatformKeyManagerEncryptionActionMock: vi.fn(),
	sendPlatformDiagnosticsTestEmailActionMock: vi.fn(),
}));

vi.mock("./actions", () => ({
	refreshPlatformDiagnosticsAction: refreshPlatformDiagnosticsActionMock,
	testPlatformKeyManagerEncryptionAction: testPlatformKeyManagerEncryptionActionMock,
	sendPlatformDiagnosticsTestEmailAction: sendPlatformDiagnosticsTestEmailActionMock,
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
	Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
		<span {...props}>{children}</span>
	),
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
		<section {...props}>{children}</section>
	),
	CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
		<div {...props}>{children}</div>
	),
	CardDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
		<p {...props}>{children}</p>
	),
	CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
		<header {...props}>{children}</header>
	),
	CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
		<h2 {...props}>{children}</h2>
	),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

function snapshot(
	overrides: Partial<PlatformDiagnosticsSnapshot> = {},
): PlatformDiagnosticsSnapshot {
	return {
		fetchedAt: "2026-05-10T12:00:00.000Z",
		overallStatus: "healthy",
		secretStoreProvider: "scaleway",
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
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		expect(screen.getByText("Deployment Diagnostics")).toBeTruthy();
		expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
		expect(screen.getByText("Billing")).toBeTruthy();
		expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("defaults the email test recipient to the signed-in admin email", () => {
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		expect(screen.getByLabelText("Recipient email")).toHaveProperty("value", "admin@example.com");
	});

	it("keeps item status labels accessible when the visual label is hidden", () => {
		const { container } = render(
			<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />,
		);

		const hiddenStatusLabels = Array.from(container.querySelectorAll(".sr-only")).map(
			(element) => element.textContent,
		);

		expect(hiddenStatusLabels).toContain("Disabled");
		expect(hiddenStatusLabels).toContain("Healthy");
	});

	it("refreshes the snapshot when the refresh action succeeds", async () => {
		refreshPlatformDiagnosticsActionMock.mockResolvedValue({
			success: true,
			data: snapshot({
				fetchedAt: "2026-05-10T12:05:00.000Z",
				overallStatus: "warning",
				recommendedActions: ["Check Redis connectivity and worker queue configuration."],
				health: [
					{
						title: "Queue / Redis",
						status: "warning",
						value: "Unavailable",
						description: "BullMQ queue connectivity check.",
					},
				],
			}),
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh diagnostics" }));

		await waitFor(() => expect(screen.getAllByText("Warning").length).toBeGreaterThan(0));
		const diagnosticsStatus = screen
			.getAllByRole("status")
			.find((element) => element.textContent?.includes("Diagnostics status"));
		expect(diagnosticsStatus?.getAttribute("aria-live")).toBe("polite");
		expect(diagnosticsStatus?.textContent).toContain("Warning");
		expect(diagnosticsStatus?.textContent).toContain("2026-05-10T12:05:00.000Z");
		expect(screen.getByText("Queue / Redis")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
		expect(
			screen.getByText("Check Redis connectivity and worker queue configuration."),
		).toBeTruthy();
	});

	it("keeps the previous snapshot visible when refresh fails", async () => {
		refreshPlatformDiagnosticsActionMock.mockResolvedValue({
			success: false,
			error: "Platform admin access required",
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh diagnostics" }));

		await waitFor(() => expect(screen.getByText("Platform admin access required")).toBeTruthy());
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("sends a test email to the edited recipient and shows success", async () => {
		sendPlatformDiagnosticsTestEmailActionMock.mockResolvedValue({
			success: true,
			data: { recipient: "ops@example.com", messageId: "msg_123" },
		});
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		fireEvent.change(screen.getByLabelText("Recipient email"), {
			target: { value: "ops@example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

		await waitFor(() =>
			expect(screen.getByText("Test email sent to ops@example.com.")).toBeTruthy(),
		);
		expect(screen.getByText("Message ID: msg_123")).toBeTruthy();
		expect(sendPlatformDiagnosticsTestEmailActionMock).toHaveBeenCalledWith({
			to: "ops@example.com",
		});
	});

	it("shows an inline error when the email test fails", async () => {
		sendPlatformDiagnosticsTestEmailActionMock.mockResolvedValue({
			success: false,
			error: "Failed to send test email.",
		});
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

		await waitFor(() => expect(screen.getByText("Failed to send test email.")).toBeTruthy());
		expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("polite");
	});

	it("renders the Scaleway Key Manager encryption test card", () => {
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		expect(screen.getByText("Scaleway Key Manager Encryption")).toBeTruthy();
		expect(screen.getByText("Run an end-to-end platform key encrypt/decrypt test.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Test encryption" })).toBeTruthy();
	});

	it("hides the Scaleway Key Manager encryption test card for Vault secret store deployments", () => {
		render(
			<DiagnosticsClient
				initialSnapshot={snapshot({ secretStoreProvider: "vault" })}
				adminEmail="admin@example.com"
			/>,
		);

		expect(screen.queryByText("Scaleway Key Manager Encryption")).toBeNull();
		expect(screen.queryByRole("button", { name: "Test encryption" })).toBeNull();
	});

	it("runs the platform key manager encryption test and renders the successful result", async () => {
		testPlatformKeyManagerEncryptionActionMock.mockResolvedValue({
			success: true,
			data: {
				input: "Ada Lovelace",
				output: "Ada Lovelace",
				matches: true,
				ciphertextPreview: "ciphertext-value",
				platformKeyId: "key-created",
				keyStatus: "created",
			},
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);
		fireEvent.click(screen.getByRole("button", { name: "Test encryption" }));

		await waitFor(() => expect(screen.getByText("Input and output match")).toBeTruthy());
		expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
		expect(screen.getByText("key-created")).toBeTruthy();
		expect(screen.getByText("Created new platform key")).toBeTruthy();
		expect(screen.getByText("ciphertext-value")).toBeTruthy();
	});

	it("shows an inline error when the encryption test fails", async () => {
		testPlatformKeyManagerEncryptionActionMock.mockResolvedValue({
			success: false,
			error: "Scaleway Key Manager request failed",
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);
		fireEvent.click(screen.getByRole("button", { name: "Test encryption" }));

		await waitFor(() =>
			expect(screen.getByText("Scaleway Key Manager request failed")).toBeTruthy(),
		);
		expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("polite");
	});
});
