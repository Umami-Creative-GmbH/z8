// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiKeyResponse } from "@/lib/validations/api-key";
import { render } from "@/test/render-with-translations";
import { ApiKeyPageClient } from "./api-key-page-client";

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/actions", () => ({
	listApiKeys: vi.fn(),
	deleteApiKey: vi.fn(),
}));
// These framework-loaded dialogs are outside the documentation/download flow.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/navigation", () => ({
	Link: (props: ComponentProps<"a">) => <a {...props} />,
}));

afterEach(cleanup);

const key: ApiKeyResponse = {
	id: "key-example",
	name: "Workforce integration",
	prefix: "z8_org_example",
	organizationId: "org-example",
	createdBy: null,
	creator: null,
	createdAt: "2026-11-01T10:00:00Z",
	updatedAt: "2026-11-01T10:00:00Z",
	expiresAt: null,
	lastRequest: null,
	enabled: true,
	scopes: ["employees:read"],
	rateLimitEnabled: true,
	rateLimitMax: 100,
	rateLimitTimeWindow: 60000,
	requestCount: 0,
};

it.each([
	{ state: "empty", keys: [] },
	{ state: "populated", keys: [key] },
])(
	"offers a keyboard-accessible installation download with the $state key list",
	async ({ keys }) => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { staleTime: Infinity, retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<ApiKeyPageClient
					organizationId="org-example"
					currentUserId="admin-example"
					initialApiKeys={keys}
				/>
			</QueryClientProvider>,
		);
		const action = screen.getByRole("link", { name: "Download OpenAPI spec" });
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
		queryClient.clear();
	},
);
