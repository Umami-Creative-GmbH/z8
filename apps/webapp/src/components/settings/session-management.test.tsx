/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, listSessionsMock } = vi.hoisted(() => ({
	getSessionMock: vi.fn(),
	listSessionsMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
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
		revokeSession: vi.fn(),
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
});
