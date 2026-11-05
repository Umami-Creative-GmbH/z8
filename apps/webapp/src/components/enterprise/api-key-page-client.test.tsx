/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyResponse } from "@/lib/validations/api-key";
import { render } from "@/test/render-with-translations";
import { ApiKeyPageClient } from "./api-key-page-client";

// Server actions are the browser's RPC boundary. Seeded query data keeps this
// discovery flow independent of a database or a signed-in organization.
vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/actions", () => ({
	listApiKeys: vi.fn(),
	deleteApiKey: vi.fn(),
	createApiKey: vi.fn(),
	updateApiKey: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

const existingKey: ApiKeyResponse = {
	id: "example-key",
	name: "Payroll sync",
	prefix: "z8_example",
	organizationId: "example-org",
	createdBy: null,
	creator: null,
	createdAt: "2026-11-01T08:00:00Z",
	updatedAt: "2026-11-01T08:00:00Z",
	expiresAt: null,
	lastRequest: null,
	enabled: true,
	scopes: ["employees:read"],
	rateLimitEnabled: true,
	rateLimitMax: 100,
	rateLimitTimeWindow: 60_000,
	requestCount: 0,
};

afterEach(cleanup);

function renderApiKeys(keys: ApiKeyResponse[]) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
		},
	});
	return render(
		<QueryClientProvider client={client}>
			<ApiKeyPageClient
				organizationId="example-org"
				currentUserId="example-admin"
				initialApiKeys={keys}
			/>
		</QueryClientProvider>,
	);
}

describe("Public API discovery in API Keys", () => {
	it("offers the public reference before the first key is created", async () => {
		const user = userEvent.setup();
		renderApiKeys([]);

		expect(screen.getByRole("heading", { name: "No API Keys" })).toBeTruthy();
		const reference = screen.getByRole("link", { name: "API Reference" });
		expect(reference.getAttribute("href")).toBe(
			"https://docs.z8-time.app/docs/api-reference",
		);
		await user.tab();
		await user.tab();
		expect(document.activeElement).toBe(reference);
	});

	it.each([
		{ state: "empty", keys: [] },
		{ state: "populated", keys: [existingKey] },
	])(
		"explains read access and key authority when the key list is $state",
		async ({ keys }) => {
			const user = userEvent.setup();
			renderApiKeys(keys);

			expect(
				screen.getByText(
					"Read work periods, absences, employees, projects, customers and custom-field definitions with Public API v1. Access is read-only.",
				),
			).toBeTruthy();
			expect(
				screen.getByText(
					"An API key acts as your organization and reads only what its key scopes grant. Find endpoints, required scopes and examples in the reference.",
				),
			).toBeTruthy();
			const reference = screen.getByRole("link", { name: "API Reference" });
			expect(reference.getAttribute("href")).toBe(
				"https://docs.z8-time.app/docs/api-reference",
			);
			expect(reference.getAttribute("target")).toBe("_blank");
			expect(reference.getAttribute("rel")).toBe("noreferrer");
			await user.tab();
			await user.tab();
			expect(document.activeElement).toBe(reference);
			if (keys.length) {
				expect(screen.getByRole("link", { name: "Payroll sync" })).toBeTruthy();
			}
		},
	);
});
