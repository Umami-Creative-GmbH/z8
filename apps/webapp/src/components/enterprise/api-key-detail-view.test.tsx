/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyDetail } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import { ApiKeyDetailView } from "./api-key-detail-view";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name])),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-GB", timezone: "Europe/Berlin", timeFormat: "24h" }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

const detail: ApiKeyDetail = {
	key: {
		id: "4f8c2a1e-9b7d-4c3a-8e2f-1a2b3c4d5e6f",
		name: "Payroll sync",
		prefix: "z8_orgAbCd",
		organizationId: "org-1",
		createdBy: "user-1",
		creator: { userId: "user-1", name: "Ada Admin", email: null, departed: true },
		createdAt: "2026-09-01T08:00:00.000Z",
		updatedAt: "2026-09-01T08:00:00.000Z",
		expiresAt: null,
		lastRequest: "2026-10-10T08:00:00.000Z",
		enabled: true,
		scopes: ["employees:read", "absences:read-health"],
		rateLimitEnabled: true,
		rateLimitMax: 10,
		rateLimitTimeWindow: 60_000,
		requestCount: 3,
	},
	requests: [
		{
			id: "r1",
			method: "GET",
			route: "/api/v1/employees",
			status: 429,
			rowCount: null,
			ipAddress: "203.0.113.7",
			requestedAt: "2026-10-10T08:00:00.000Z",
		},
		{
			id: "r2",
			method: "GET",
			route: "/api/v1/employees",
			status: 200,
			rowCount: 12,
			ipAddress: null,
			requestedAt: "2026-10-10T07:59:00.000Z",
		},
	],
};

describe("ApiKeyDetailView", () => {
	it("shows the key, its creator as departed, its scopes and its recent requests", () => {
		render(<ApiKeyDetailView detail={detail} />);

		expect(screen.getByRole("heading", { name: "Payroll sync" })).toBeTruthy();
		expect(screen.getByText("Ada Admin (departed)")).toBeTruthy();
		expect(screen.getByText("Read absence health detail")).toBeTruthy();
		expect(screen.getByText("10 per minute")).toBeTruthy();
		expect(screen.getByRole("link", { name: /All API keys/ }).getAttribute("href")).toBe(
			"/settings/enterprise/api-keys",
		);

		const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByText("429")).toBeTruthy();
		expect(within(rows[0]).getByText("203.0.113.7")).toBeTruthy();
		expect(within(rows[1]).getByText("12")).toBeTruthy();
		// Times are shown in the viewer's display zone.
		expect(within(rows[0]).getByText(/10:00/)).toBeTruthy();
	});

	it("says when the key has no requests yet", () => {
		render(<ApiKeyDetailView detail={{ ...detail, requests: [] }} />);
		expect(screen.getByText("No requests in the last 90 days.")).toBeTruthy();
		expect(screen.queryByRole("table")).toBeNull();
	});
});
