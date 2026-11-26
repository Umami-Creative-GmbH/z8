/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlackPrepareTestPanel } from "@/components/settings/slack-prepare-test-panel";
import type { SlackCandidateSetupView } from "@/lib/chat-installations/slack-setup";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			if (!defaultValue) return _key;
			if (!params) return defaultValue;
			return Object.entries(params).reduce(
				(text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
				defaultValue,
			);
		},
	}),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		refresh: vi.fn(),
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function makeSetupView(overrides: Partial<SlackCandidateSetupView> = {}): SlackCandidateSetupView {
	return {
		installationId: "11111111-1111-4111-8111-111111111111",
		organizationId: "org-1",
		routeId: "route_abc123",
		status: "candidate",
		verificationState: "pending",
		readyForSwitch: false,
		externalAppId: "A01CANDIDATE",
		externalBotId: "U01BOTUSER",
		externalBotUsername: "z8-org-bot",
		externalSpaceId: "T01WORKSPACE",
		externalSpaceName: "Acme Workspace",
		hasStoredCredentials: true,
		credentialRevisionNumber: 1,
		urls: {
			eventsUrl: "https://app.z8-time.test/api/slack/installations/route_abc123/events",
			interactionsUrl: "https://app.z8-time.test/api/slack/installations/route_abc123/interactions",
			commandsUrl: "https://app.z8-time.test/api/slack/installations/route_abc123/commands",
		},
		manifestJson: '{"display_information":{"name":"Z8"}}',
		manifestYaml: 'display_information:\n  name: "Z8"',
		steps: {
			credentials: {
				status: "passed",
				verifiedAt: "2026-11-26T12:00:00.000Z",
				expiresAt: null,
				detail: null,
				failureCode: null,
			},
			identity: {
				status: "passed",
				verifiedAt: "2026-11-26T12:00:00.000Z",
				expiresAt: null,
				detail: "A01CANDIDATE / Acme Workspace",
				failureCode: null,
			},
			signedEvent: {
				status: "pending",
				verifiedAt: null,
				expiresAt: null,
				detail: null,
				failureCode: null,
			},
			privateTest: {
				status: "pending",
				verifiedAt: null,
				expiresAt: null,
				detail: null,
				failureCode: null,
			},
		},
		lastVerifiedAt: null,
		updatedAt: "2026-11-26T12:00:00.000Z",
		...overrides,
	};
}

describe("SlackPrepareTestPanel", () => {
	beforeEach(() => vi.clearAllMocks());

	it("generates manifest on Prepare and keeps credential inputs write-only (type=password, cleared after save)", async () => {
		const preparedView = makeSetupView({
			hasStoredCredentials: false,
			credentialRevisionNumber: null,
			steps: {
				credentials: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
				identity: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
				signedEvent: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
				privateTest: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
			},
		});
		const savedView = makeSetupView();
		const prepareAction = vi.fn().mockResolvedValue({ success: true, data: preparedView });
		const saveCredentialsAction = vi.fn().mockResolvedValue({ success: true, data: savedView });

		renderWithQueryClient(
			<SlackPrepareTestPanel
				initialSetup={null}
				prepareAction={prepareAction}
				refreshAction={vi.fn()}
				saveCredentialsAction={saveCredentialsAction}
				sendPrivateTestAction={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Generate Slack app manifest/i }));

		await waitFor(() => expect(prepareAction).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByDisplayValue(
				"https://app.z8-time.test/api/slack/installations/route_abc123/events",
			),
		).toBeTruthy();

		const botTokenInput = screen.getByLabelText(/Bot User OAuth Token/i) as HTMLInputElement;
		const signingSecretInput = screen.getByLabelText(/Signing Secret/i) as HTMLInputElement;
		expect(botTokenInput.type).toBe("password");
		expect(signingSecretInput.type).toBe("password");

		fireEvent.change(botTokenInput, { target: { value: "xoxb-write-only-secret-token" } });
		fireEvent.change(signingSecretInput, {
			target: { value: "a1b2c3d4e5f60718293a4b5c6d7e8f90" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Verify & save credentials/i }));

		await waitFor(() => expect(saveCredentialsAction).toHaveBeenCalledTimes(1));
		await waitFor(() => {
			expect(botTokenInput.value).toBe("");
			expect(signingSecretInput.value).toBe("");
		});
		expect(screen.getByText(/Stored \(revision v1\)/i)).toBeTruthy();
	});

	it("shows expired and failed verification steps with actionable retry buttons and polite live announcements", async () => {
		const expiredView = makeSetupView({
			verificationState: "expired",
			readyForSwitch: false,
			steps: {
				credentials: {
					status: "passed",
					verifiedAt: "2026-11-25T10:00:00.000Z",
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
				identity: {
					status: "passed",
					verifiedAt: "2026-11-25T10:00:00.000Z",
					expiresAt: null,
					detail: "A01CANDIDATE / Acme Workspace",
					failureCode: null,
				},
				signedEvent: {
					status: "expired",
					verifiedAt: "2026-11-25T10:00:00.000Z",
					expiresAt: "2026-11-26T10:00:00.000Z",
					detail: "app_mention",
					failureCode: "signed_event_expired",
				},
				privateTest: {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: "channel_not_found",
				},
			},
		});

		const readyView = makeSetupView({
			verificationState: "verified",
			readyForSwitch: true,
			steps: {
				credentials: {
					status: "passed",
					verifiedAt: "2026-11-26T12:00:00.000Z",
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
				identity: {
					status: "passed",
					verifiedAt: "2026-11-26T12:00:00.000Z",
					expiresAt: null,
					detail: "A01CANDIDATE / Acme Workspace",
					failureCode: null,
				},
				signedEvent: {
					status: "passed",
					verifiedAt: "2026-11-26T12:05:00.000Z",
					expiresAt: "2026-11-27T12:05:00.000Z",
					detail: "app_mention",
					failureCode: null,
				},
				privateTest: {
					status: "passed",
					verifiedAt: "2026-11-26T12:06:00.000Z",
					expiresAt: "2026-11-27T12:06:00.000Z",
					detail: "UADMIN1234",
					failureCode: null,
				},
			},
		});

		const refreshAction = vi.fn().mockResolvedValue({ success: true, data: expiredView });
		const sendPrivateTestAction = vi.fn().mockResolvedValue({ success: true, data: readyView });

		const { container } = renderWithQueryClient(
			<SlackPrepareTestPanel
				initialSetup={expiredView}
				prepareAction={vi.fn()}
				refreshAction={refreshAction}
				saveCredentialsAction={vi.fn()}
				sendPrivateTestAction={sendPrivateTestAction}
			/>,
		);

		expect(screen.getByText("Expired")).toBeTruthy();
		expect(screen.getByText("Action needed")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Recheck signed event/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Retry private test/i })).toBeTruthy();

		const memberInput = screen.getByLabelText(/Your Slack Member ID/i);
		fireEvent.change(memberInput, { target: { value: "UADMIN1234" } });
		fireEvent.click(screen.getByRole("button", { name: /Retry private test/i }));

		await waitFor(() => expect(sendPrivateTestAction).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(/Ready to review switch/i)).toBeTruthy();

		const liveRegion = container.querySelector('[aria-live="polite"]');
		expect(liveRegion?.textContent).toMatch(/Slack app verification complete/i);
	});
});
