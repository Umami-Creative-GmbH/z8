/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	deleteApiKey,
	listApiKeys,
} from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
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

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/view-actions", () => ({
	readApiKeysForView: (...args: unknown[]) => vi.mocked(listApiKeys)(...(args as [])),
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
	it("removes the retained snapshot after an authoritative read refusal", async () => {
		vi.mocked(listApiKeys).mockResolvedValue({
			success: false,
			error: "Refused",
			code: "AuthorizationError",
		});
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<ApiKeyPageClient
					organizationId="example-org"
					currentUserId="example-admin"
					initialApiKeys={[existingKey]}
				/>
			</QueryClientProvider>,
		);
		await waitFor(() => expect(screen.queryByRole("link", { name: "Payroll sync" })).toBeNull());
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByText("No API Keys")).toBeNull();
		expect(screen.getByRole("button", { name: "Create Key" })).toHaveProperty("disabled", true);
	});
	it("retains revoke confirmation while pending and after refusal, preventing duplicate commands", async () => {
		let finish!: (value: Awaited<ReturnType<typeof deleteApiKey>>) => void;
		vi.mocked(deleteApiKey).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		renderApiKeys([existingKey]);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "More actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Delete" }));
		const confirm = screen.getByRole("button", { name: "Delete" });
		act(() => {
			fireEvent.click(confirm);
			fireEvent.click(confirm);
		});
		await waitFor(() => expect(deleteApiKey).toHaveBeenCalledTimes(1));
		await user.keyboard("{Escape}");
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		await act(async () => finish({ success: false, error: "Refused", code: "AuthorizationError" }));
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Payroll sync", hidden: true })).toBeTruthy();
	});
	it("retains its same-organization records after a failed refresh and recovers with Retry", async () => {
		vi.mocked(listApiKeys).mockResolvedValueOnce({ success: false, error: "Unavailable" });
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<ApiKeyPageClient
					organizationId="example-org"
					currentUserId="example-admin"
					initialApiKeys={[existingKey]}
				/>
			</QueryClientProvider>,
		);
		await waitFor(() => expect(listApiKeys).toHaveBeenCalled());
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Payroll sync" })).toBeTruthy();
		expect(screen.queryByText("No API Keys")).toBeNull();
		vi.mocked(listApiKeys).mockResolvedValue({ success: true, data: [] });
		await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByRole("heading", { name: "No API Keys" })).toBeTruthy();
	});
	it("offers the public reference before the first key is created", async () => {
		const user = userEvent.setup();
		renderApiKeys([]);

		expect(screen.getByRole("heading", { name: "No API Keys" })).toBeTruthy();
		const reference = screen.getByRole("link", { name: "API Reference" });
		expect(reference.getAttribute("href")).toBe("https://docs.z8-time.app/docs/api-reference");
		for (let i = 0; i < 30 && document.activeElement !== reference; i++) await user.tab();
		expect(document.activeElement).toBe(reference);
	});

	it.each([
		{ state: "empty", keys: [] },
		{ state: "populated", keys: [existingKey] },
	])("explains read access and key authority when the key list is $state", async ({ keys }) => {
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
		expect(reference.getAttribute("href")).toBe("https://docs.z8-time.app/docs/api-reference");
		expect(reference.getAttribute("target")).toBe("_blank");
		expect(reference.getAttribute("rel")).toBe("noreferrer");
		for (let i = 0; i < 30 && document.activeElement !== reference; i++) await user.tab();
		expect(document.activeElement).toBe(reference);
		if (keys.length) {
			expect(screen.getByRole("link", { name: "Payroll sync" })).toBeTruthy();
		}
	});

	it.each([
		{ state: "empty", keys: [] },
		{ state: "populated", keys: [existingKey] },
	])(
		"offers a keyboard-accessible installation download with the $state key list",
		async ({ keys }) => {
			renderApiKeys(keys);
			const action = screen.getByRole("link", {
				name: "Download OpenAPI spec",
			});
			expect(action.getAttribute("href")).toBe("/api/v1/openapi.json");
			expect(action.getAttribute("download")).toBe("z8-public-api-v1.openapi.json");
			const user = userEvent.setup();
			for (let step = 0; step < 10 && document.activeElement !== action; step++) {
				await user.tab();
			}
			expect(document.activeElement).toBe(action);
			let activated = false;
			action.addEventListener("click", (event) => {
				event.preventDefault(); // jsdom does not implement browser file downloads.
				activated = true;
			});
			await user.keyboard("{Enter}");
			expect(activated).toBe(true);
		},
	);
});
