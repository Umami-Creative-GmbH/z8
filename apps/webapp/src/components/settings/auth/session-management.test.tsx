/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, listSessionsMock, revokeSessionMock } = vi.hoisted(() => ({
	getSessionMock: vi.fn(),
	listSessionsMock: vi.fn(),
	revokeSessionMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [name, value]) => text.replace(`{${name}}`, String(value)),
				defaultValue ?? _key,
			),
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		getSession: getSessionMock,
		listSessions: listSessionsMock,
		revokeSession: revokeSessionMock,
		revokeOtherSessions: vi.fn(),
	},
}));

import { SessionManagement } from "./session-management";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function renderSessionManagement() {
	return render(
		<QueryClientProvider client={createQueryClient()}>
			<SessionManagement />
		</QueryClientProvider>,
	);
}

describe("SessionManagement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSessionMock.mockResolvedValue({ data: { session: { token: "current-token" } } });
	});

	it("uses CSS truncation for long IPv6 addresses in the active sessions list", async () => {
		const ipAddress = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
		listSessionsMock.mockResolvedValue({
			data: [
				{
					id: "session-1",
					token: "current-token",
					userId: "user-1",
					expiresAt: new Date("2026-01-01T00:00:00.000Z"),
					ipAddress,
					userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
					createdAt: new Date("2025-01-01T00:00:00.000Z"),
				},
			],
		});

		renderSessionManagement();

		const ip = await screen.findByText(ipAddress);

		expect(ip.className).toContain("truncate");
		expect(ip.parentElement?.getAttribute("title")).toBe(ipAddress);
	});

	it("revokes another session only after confirming it by name", async () => {
		revokeSessionMock.mockResolvedValue({ data: { status: true } });
		listSessionsMock.mockResolvedValue({
			data: [
				{
					id: "session-1",
					token: "current-token",
					userId: "user-1",
					expiresAt: new Date("2026-01-01T00:00:00.000Z"),
					userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
					createdAt: new Date("2025-01-01T00:00:00.000Z"),
				},
				{
					id: "session-2",
					token: "other-token",
					userId: "user-1",
					expiresAt: new Date("2026-01-01T00:00:00.000Z"),
					userAgent: "Mozilla/5.0 (Macintosh; Mac OS X) Firefox/120.0",
					createdAt: new Date("2025-01-01T00:00:00.000Z"),
				},
			],
		});

		renderSessionManagement();

		fireEvent.click(
			await screen.findByRole("button", { name: "Revoke session: Firefox on macOS" }),
		);
		expect(revokeSessionMock).not.toHaveBeenCalled();
		expect(await screen.findByText("Revoke this session?")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

		await waitFor(() => expect(revokeSessionMock).toHaveBeenCalledWith({ token: "other-token" }));
	});

	it("explains a failed session load and offers a retry", async () => {
		listSessionsMock.mockResolvedValue({ data: null, error: { message: "Unauthorized" } });

		renderSessionManagement();

		expect(
			await screen.findByText("Your active sessions could not be loaded. Try again."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByText("No active sessions")).toBeNull();
	});
});
