/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackConnectButton } from "./slack-connect-button";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const assign = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("SlackConnectButton", () => {
	it("starts the Slack OAuth flow for the organization and opens Slack", async () => {
		const fetchMock = mockFetch(200, {
			authUrl: "https://slack.com/oauth/v2/authorize?client_id=x&state=y",
		});
		render(<SlackConnectButton organizationId="org-1" navigate={assign} />);

		fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

		await waitFor(() =>
			expect(assign).toHaveBeenCalledWith(
				"https://slack.com/oauth/v2/authorize?client_id=x&state=y",
			),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/slack/oauth/authorize",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ organizationId: "org-1" }),
			}),
		);
		expect(
			screen.getByRole("button", { name: "Connect Slack" }).hasAttribute("disabled"),
		).toBe(true);
	});

	it("never navigates to a non-Slack URL", async () => {
		mockFetch(200, { authUrl: "https://evil.example/authorize" });
		render(<SlackConnectButton organizationId="org-1" navigate={assign} />);

		fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Slack connection could not be started. Try again.",
			),
		);
		expect(assign).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Connect Slack" }).hasAttribute("disabled"),
		).toBe(false);
	});

	it("explains when Slack is not configured on the installation", async () => {
		mockFetch(503, { error: "Slack integration is not configured" });
		render(<SlackConnectButton organizationId="org-1" navigate={assign} />);

		fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Slack is not available on this Z8 installation.",
			),
		);
	});
});
