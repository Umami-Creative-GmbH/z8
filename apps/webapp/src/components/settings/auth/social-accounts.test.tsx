/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { linkSocialMock, listAccountsMock } = vi.hoisted(() => ({
	linkSocialMock: vi.fn(),
	listAccountsMock: vi.fn(),
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
		linkSocial: linkSocialMock,
		listAccounts: listAccountsMock,
		unlinkAccount: vi.fn(),
	},
}));

import { SocialAccounts } from "./social-accounts";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function renderSocialAccounts(enabledProviderIds: string[]) {
	return render(
		<QueryClientProvider client={createQueryClient()}>
			<SocialAccounts enabledProviderIds={enabledProviderIds} />
		</QueryClientProvider>,
	);
}

describe("SocialAccounts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listAccountsMock.mockResolvedValue({ data: [] });
		linkSocialMock.mockResolvedValue({ data: null });
	});

	it("hides social providers that are not configured", async () => {
		renderSocialAccounts(["github"]);

		expect(await screen.findByText("GitHub")).toBeTruthy();
		expect(screen.queryByText("Google")).toBeNull();
		expect(screen.queryByText("LinkedIn")).toBeNull();
		expect(screen.queryByText("Apple")).toBeNull();
	});

	it("links configured providers through the Better Auth client", async () => {
		renderSocialAccounts(["github"]);

		const connectButton = await screen.findByRole("button", { name: "Connect" });
		await waitFor(() => expect(connectButton.hasAttribute("disabled")).toBe(false));
		fireEvent.click(connectButton);

		await waitFor(() => {
			expect(linkSocialMock).toHaveBeenCalledWith({
				provider: "github",
				callbackURL: "/settings/security",
			});
		});
	});
});
