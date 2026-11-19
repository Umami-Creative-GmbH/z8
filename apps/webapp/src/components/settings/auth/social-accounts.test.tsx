/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { linkSocialMock, listAccountsMock, unlinkAccountMock } = vi.hoisted(() => ({
	linkSocialMock: vi.fn(),
	listAccountsMock: vi.fn(),
	unlinkAccountMock: vi.fn(),
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
		linkSocial: linkSocialMock,
		listAccounts: listAccountsMock,
		unlinkAccount: unlinkAccountMock,
	},
}));

import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { SocialAccounts } from "./social-accounts";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function renderSocialAccounts(
	enabledProviderIds: string[],
	{ locale = "en", timezone = "UTC" }: { locale?: string; timezone?: string } = {},
) {
	return render(
		<AppLocaleProvider locale={locale}>
			<UserPreferencesProvider timezone={timezone}>
				<QueryClientProvider client={createQueryClient()}>
					<SocialAccounts enabledProviderIds={enabledProviderIds} />
				</QueryClientProvider>
			</UserPreferencesProvider>
		</AppLocaleProvider>,
	);
}

describe("SocialAccounts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listAccountsMock.mockResolvedValue({ data: [] });
		linkSocialMock.mockResolvedValue({ data: null });
		unlinkAccountMock.mockResolvedValue({ data: null });
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

	it("unlinks an account by its Better Auth account row id", async () => {
		listAccountsMock.mockResolvedValue({
			data: [
				{
					id: "local-row-1",
					providerId: "github",
					accountId: "github-subject-7",
					createdAt: new Date(),
				},
			],
		});
		renderSocialAccounts(["github"]);

		fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
		expect(await screen.findByText("Disconnect GitHub?")).toBeTruthy();
		expect(unlinkAccountMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

		await waitFor(() => {
			expect(unlinkAccountMock).toHaveBeenCalledWith({ accountId: "local-row-1" });
		});
	});

	it("shows when an account was connected instead of the provider subject id", async () => {
		listAccountsMock.mockResolvedValue({
			data: [
				{
					id: "local-row-1",
					providerId: "github",
					accountId: "github-subject-7",
					// 23:30 UTC is already the next day in Berlin.
					createdAt: "2026-03-14T23:30:00.000Z",
				},
			],
		});
		const { container } = renderSocialAccounts(["github"], {
			locale: "en",
			timezone: "Europe/Berlin",
		});

		expect(await screen.findByText("Connected on Mar 15, 2026")).toBeTruthy();
		expect(container.innerHTML).not.toContain("github-subject-7");
	});

	it("formats the connection date in the app language", async () => {
		listAccountsMock.mockResolvedValue({
			data: [
				{
					id: "local-row-1",
					providerId: "github",
					accountId: "github-subject-7",
					createdAt: new Date("2026-03-14T10:00:00.000Z"),
				},
			],
		});
		renderSocialAccounts(["github"], { locale: "de", timezone: "Europe/Berlin" });

		expect(await screen.findByText("Connected on 14. März 2026")).toBeTruthy();
	});

	it("falls back to a generic linked status when the connection date is missing", async () => {
		listAccountsMock.mockResolvedValue({
			data: [{ id: "local-row-1", providerId: "github", accountId: "github-subject-7" }],
		});
		const { container } = renderSocialAccounts(["github"]);

		expect(await screen.findByText("Linked for sign-in")).toBeTruthy();
		expect(container.innerHTML).not.toContain("github-subject-7");
	});

	it("explains a failed account load instead of offering to connect linked providers", async () => {
		listAccountsMock.mockResolvedValue({ data: null, error: { message: "Unauthorized" } });
		renderSocialAccounts(["github"]);

		expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
	});

	it("renders nothing when no provider is configured or connected", async () => {
		const { container } = renderSocialAccounts([]);

		await waitFor(() => expect(listAccountsMock).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});
});
