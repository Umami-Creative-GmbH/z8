/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsPrepareTestPanel } from "@/components/settings/teams-prepare-test-panel";
import type { TeamsCandidateSetupView } from "@/lib/chat-installations/teams-app-package";

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

function makeTeamsSetupView(
	overrides: Partial<TeamsCandidateSetupView> = {},
): TeamsCandidateSetupView {
	return {
		installationId: "22222222-2222-4222-8222-222222222222",
		organizationId: "org-1",
		routeId: "route_teams_abc",
		status: "candidate",
		verificationState: "pending",
		readyForSwitch: false,
		microsoftAppId: "11111111-2222-4333-8444-555555555551",
		microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
		tenantDisplayName: "Acme M365",
		hasStoredCredentials: true,
		credentialRevisionNumber: 1,
		messagingEndpointUrl:
			"https://app.z8-time.test/api/teams/installations/route_teams_abc/messages",
		manifestJson: '{"manifestVersion":"1.16","id":"11111111-2222-4333-8444-555555555551"}',
		manifestFileName: "manifest.json",
		packageFileName: "z8-teams-single-tenant-app.zip",
		usesPlaceholderAppId: false,
		rolloutInstructions: [
			{
				stepNumber: 1,
				id: "azure_bot_registration",
				title: "Create a Single-Tenant Azure Bot & Entra App Registration",
				summary: "Create an Azure Bot with Type = Single Tenant.",
			},
			{
				stepNumber: 2,
				id: "upload_teams_admin_center",
				title: "Upload app package in Microsoft Teams Admin Center",
				summary: "Upload the .zip package in admin.teams.microsoft.com.",
			},
		],
		hasPrivateReachability: false,
		privateReachabilityUpdatedAt: null,
		enrollmentProofCount: 0,
		steps: {
			credentials: {
				status: "passed",
				verifiedAt: "2026-11-26T12:00:00.000Z",
				expiresAt: null,
				detail: "11111111-2222-4333-8444-555555555551 / Acme M365",
				failureCode: null,
			},
			inboundProof: {
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

describe("TeamsPrepareTestPanel (#2049)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("prepares the single-tenant package, displays endpoint & rollout steps, and keeps client secret write-only", async () => {
		const preparedView = makeTeamsSetupView({
			microsoftAppId: null,
			microsoftTenantId: null,
			tenantDisplayName: null,
			hasStoredCredentials: false,
			credentialRevisionNumber: null,
			usesPlaceholderAppId: true,
			steps: {
				credentials: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
				inboundProof: {
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
		const savedView = makeTeamsSetupView();
		const prepareAction = vi.fn().mockResolvedValue({ success: true, data: preparedView });
		const saveCredentialsAction = vi.fn().mockResolvedValue({ success: true, data: savedView });

		renderWithQueryClient(
			<TeamsPrepareTestPanel
				initialSetup={null}
				prepareAction={prepareAction}
				refreshAction={vi.fn()}
				saveCredentialsAction={saveCredentialsAction}
				sendProactiveTestAction={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Prepare single-tenant Teams app/i }));

		await waitFor(() => expect(prepareAction).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByDisplayValue(
				"https://app.z8-time.test/api/teams/installations/route_teams_abc/messages",
			),
		).toBeTruthy();
		expect(screen.getByText(/Microsoft Teams Admin Center rollout instructions/i)).toBeTruthy();

		const appIdInput = screen.getByLabelText(/Microsoft App ID/i) as HTMLInputElement;
		const tenantIdInput = screen.getByLabelText(/Microsoft Entra Tenant ID/i) as HTMLInputElement;
		const passwordInput = screen.getByLabelText(/Microsoft App Password/i) as HTMLInputElement;
		expect(passwordInput.type).toBe("password");

		fireEvent.change(appIdInput, {
			target: { value: "11111111-2222-4333-8444-555555555551" },
		});
		fireEvent.change(tenantIdInput, {
			target: { value: "aaaa1111-2222-4333-8444-555555555551" },
		});
		fireEvent.change(passwordInput, {
			target: { value: "write-only-client-secret-999" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Save single-tenant credentials/i }));

		await waitFor(() => expect(saveCredentialsAction).toHaveBeenCalledTimes(1));
		await waitFor(() => {
			expect(passwordInput.value).toBe("");
		});
		expect(screen.getByText(/Stored \(revision v1\)/i)).toBeTruthy();
	});

	it("shows failed/expired steps with actionable retry, triggers proactive private test, and announces readiness politely", async () => {
		const failedView = makeTeamsSetupView({
			verificationState: "failed",
			hasPrivateReachability: true,
			steps: {
				credentials: {
					status: "passed",
					verifiedAt: "2026-11-26T12:00:00.000Z",
					expiresAt: null,
					detail: "11111111-2222-4333-8444-555555555551 / Acme M365",
					failureCode: null,
				},
				inboundProof: {
					status: "expired",
					verifiedAt: "2026-11-25T10:00:00.000Z",
					expiresAt: "2026-11-26T10:00:00.000Z",
					detail: "message",
					failureCode: "inbound_proof_expired",
				},
				privateTest: {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: "missing_private_reachability",
				},
			},
		});
		const readyView = makeTeamsSetupView({
			verificationState: "verified",
			readyForSwitch: true,
			hasPrivateReachability: true,
			steps: {
				credentials: {
					status: "passed",
					verifiedAt: "2026-11-26T12:00:00.000Z",
					expiresAt: null,
					detail: "11111111-2222-4333-8444-555555555551 / Acme M365",
					failureCode: null,
				},
				inboundProof: {
					status: "passed",
					verifiedAt: "2026-11-26T12:05:00.000Z",
					expiresAt: "2026-11-27T12:05:00.000Z",
					detail: "message",
					failureCode: null,
				},
				privateTest: {
					status: "passed",
					verifiedAt: "2026-11-26T12:06:00.000Z",
					expiresAt: "2026-11-27T12:06:00.000Z",
					detail: "a:personal-conv-1",
					failureCode: null,
				},
			},
		});

		const sendProactiveTestAction = vi.fn().mockResolvedValue({ success: true, data: readyView });
		const refreshAction = vi.fn().mockResolvedValue({ success: true, data: readyView });

		renderWithQueryClient(
			<TeamsPrepareTestPanel
				initialSetup={failedView}
				prepareAction={vi.fn()}
				refreshAction={refreshAction}
				saveCredentialsAction={vi.fn()}
				sendProactiveTestAction={sendProactiveTestAction}
			/>,
		);

		expect(screen.getByText(/missing_private_reachability/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /Recheck inbound activity/i })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Retry proactive private test/i }));

		await waitFor(() => expect(sendProactiveTestAction).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByText(/passed credential, authenticated inbound activity, and proactive/i),
		).toBeTruthy();
		const liveRegion = document.querySelector('[aria-live="polite"]');
		expect(liveRegion?.textContent).toMatch(/verification complete/i);
	});
});
