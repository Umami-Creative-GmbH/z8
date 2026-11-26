/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ChatInstallationRecoveryState,
	getProviderRotationGuidance,
} from "@/lib/chat-installations/recovery-lifecycle";
import { ChatInstallationRecoveryPanel } from "./chat-installation-recovery-panel";

const mocks = vi.hoisted(() => ({
	routerRefresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string>) => {
			if (!defaultValue) return _key;
			if (!params) return defaultValue;
			return Object.entries(params).reduce(
				(acc, [k, v]) => acc.replaceAll(`{${k}}`, v),
				defaultValue,
			);
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: mocks.toastSuccess,
		error: mocks.toastError,
	},
}));

const activeInstId = "11111111-1111-4111-8111-111111111111";
const revokedInstId = "22222222-2222-4222-8222-222222222222";

const baseState: ChatInstallationRecoveryState = {
	organizationId: "org-1",
	provider: "slack",
	activeInstallation: {
		id: activeInstId,
		provider: "slack",
		credentialSource: "organization_owned",
		status: "active",
		routeId: "route-active-1",
		externalAppId: "A_SLACK_1",
		externalBotId: "U_BOT_1",
		externalBotUsername: "z8-acme",
		externalDisplayName: "Z8 Acme",
		externalSpaceId: "T_ACME",
		externalSpaceName: "Acme Workspace",
		activeCredentialRevisionId: "33333333-3333-4333-8333-333333333333",
		verificationState: "verified",
		endpointGeneration: 1,
		endpointState: "synced",
		lastVerifiedAt: "2026-11-26T12:00:00.000Z",
		rotatedAt: null,
		retiredAt: null,
		revokedAt: null,
		canRotate: true,
		canRevoke: true,
		canRestore: false,
	},
	restorableInstallations: [
		{
			id: revokedInstId,
			provider: "slack",
			credentialSource: "organization_owned",
			status: "revoked",
			routeId: "route-prev-1",
			externalAppId: "A_SLACK_PREV",
			externalBotId: "U_BOT_PREV",
			externalBotUsername: "z8-prev",
			externalDisplayName: "Previous Slack App",
			externalSpaceId: "T_ACME",
			externalSpaceName: "Acme Workspace",
			activeCredentialRevisionId: null,
			verificationState: "unverified",
			endpointGeneration: 2,
			endpointState: "removed",
			lastVerifiedAt: null,
			rotatedAt: null,
			retiredAt: null,
			revokedAt: "2026-11-25T10:00:00.000Z",
			canRotate: false,
			canRevoke: false,
			canRestore: true,
		},
	],
	restoreCandidateSetup: null,
	restoreCandidatePreview: null,
	pendingCleanupJobs: [],
	rotationGuidance: getProviderRotationGuidance("slack"),
};

function renderPanel(overrides: Partial<Parameters<typeof ChatInstallationRecoveryPanel>[0]> = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ChatInstallationRecoveryPanel
				channelName="Slack"
				initialState={baseState}
				refreshStateAction={vi.fn(async () => ({ success: true as const, data: baseState }))}
				rotateCredentialsAction={vi.fn(async () => ({
					success: true as const,
					data: {
						kind: "rotated" as const,
						installationId: activeInstId,
						routeId: "route-active-1",
						provider: "slack" as const,
						previousRevisionId: "33333333-3333-4333-8333-333333333333",
						newRevisionId: "44444444-4444-4444-8444-444444444444",
						newRevisionNumber: 2,
						queuedCleanupJobId: "55555555-5555-4555-8555-555555555555",
						guidance: getProviderRotationGuidance("slack"),
						recoveryState: baseState,
					},
				}))}
				revokeInstallationAction={vi.fn(async () => ({
					success: true as const,
					data: {
						kind: "revoked" as const,
						installationId: activeInstId,
						provider: "slack" as const,
						endpointGeneration: 2,
						queuedCredentialCleanupCount: 1,
						queuedEndpointCleanup: true,
						recoveryState: { ...baseState, activeInstallation: null },
					},
				}))}
				prepareRestoreAction={vi.fn(async () => ({
					success: true as const,
					data: {
						kind: "restore_started" as const,
						installationId: revokedInstId,
						routeId: "route-prev-1",
						provider: "slack" as const,
						endpointGeneration: 3,
						endpointState: "synced" as const,
						requiresCredentials: true,
						status: "candidate" as const,
						recoveryState: baseState,
					},
				}))}
				verifyRestoreAction={vi.fn(async () => ({
					success: true as const,
					data: {
						kind: "verified_step" as const,
						installationId: revokedInstId,
						provider: "slack" as const,
						readyForSwitch: true,
						verificationState: "verified" as const,
						activeCredentialRevisionId: "66666666-6666-4666-8666-666666666666",
						recoveryState: baseState,
					},
				}))}
				confirmRestoreAction={vi.fn(async () => ({
					success: false as const,
					error: "not configured",
					code: "ValidationError",
				}))}
				{...overrides}
			/>
		</QueryClientProvider>,
	);
}

describe("ChatInstallationRecoveryPanel (#2046)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens rotate dialog with write-only inputs and interruption guidance, rotates credentials, shows post-rotation checklist, and restores focus on close", async () => {
		const rotateCredentialsAction = vi.fn(async () => ({
			success: true as const,
			data: {
				kind: "rotated" as const,
				installationId: activeInstId,
				routeId: "route-active-1",
				provider: "slack" as const,
				previousRevisionId: "33333333-3333-4333-8333-333333333333",
				newRevisionId: "44444444-4444-4444-8444-444444444444",
				newRevisionNumber: 2,
				queuedCleanupJobId: "55555555-5555-4555-8555-555555555555",
				guidance: getProviderRotationGuidance("slack"),
				recoveryState: baseState,
			},
		}));

		renderPanel({ rotateCredentialsAction });

		const rotateTrigger = screen.getByRole("button", { name: "Rotate credentials" });
		fireEvent.click(rotateTrigger);

		// Dialog displays provider interruption details & write-only password inputs
		expect(screen.getByText("Rotate Slack credentials")).toBeTruthy();
		expect(screen.getByText("Provider-imposed interruption")).toBeTruthy();

		const botTokenInput = screen.getByLabelText(
			"Bot User OAuth Token (write-only)",
		) as HTMLInputElement;
		const signingSecretInput = screen.getByLabelText(
			"Signing Secret (write-only)",
		) as HTMLInputElement;
		expect(botTokenInput.type).toBe("password");
		expect(signingSecretInput.type).toBe("password");

		// Cancel restores focus back to the trigger button
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(document.activeElement).toBe(rotateTrigger);
		});

		// Re-open, fill write-only credentials, submit rotation
		fireEvent.click(rotateTrigger);
		fireEvent.change(screen.getByLabelText("Bot User OAuth Token (write-only)"), {
			target: { value: "xoxb-rotated-token-123456" },
		});
		fireEvent.change(screen.getByLabelText("Signing Secret (write-only)"), {
			target: { value: "rotated_signing_secret_0123456789" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Verify identity & rotate" }));

		await waitFor(() => {
			expect(rotateCredentialsAction).toHaveBeenCalledWith({
				installationId: activeInstId,
				botToken: "xoxb-rotated-token-123456",
				signingSecret: "rotated_signing_secret_0123456789",
			});
		});

		// Post-rotation verification checklist shown & focus restored to trigger button
		await waitFor(() => {
			expect(
				screen.getByText(/Credentials rotated to revision v2 — verify recovery/i),
			).toBeTruthy();
			expect(document.activeElement).toBe(rotateTrigger);
		});
	});

	it("opens immediate revoke dialog explaining Z8 inbox continuity and restores focus on cancel", async () => {
		const revokeInstallationAction = vi.fn(async () => ({
			success: true as const,
			data: {
				kind: "revoked" as const,
				installationId: activeInstId,
				provider: "slack" as const,
				endpointGeneration: 2,
				queuedCredentialCleanupCount: 1,
				queuedEndpointCleanup: true,
				recoveryState: { ...baseState, activeInstallation: null },
			},
		}));

		renderPanel({ revokeInstallationAction });

		const revokeTrigger = screen.getByRole("button", { name: "Revoke access immediately" });
		fireEvent.click(revokeTrigger);

		expect(screen.getByText("Revoke Slack access immediately?")).toBeTruthy();
		expect(screen.getByText(/Pending approvals remain available in the Z8 inbox/i)).toBeTruthy();

		// Cancel restores focus back to revokeTrigger
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(document.activeElement).toBe(revokeTrigger);
		});

		// Re-open and confirm immediate revocation
		fireEvent.click(revokeTrigger);
		fireEvent.click(screen.getByRole("button", { name: "Confirm immediate revocation" }));

		await waitFor(() => {
			expect(revokeInstallationAction).toHaveBeenCalledWith({ installationId: activeInstId });
		});
	});

	it("lists previous installations and initiates restore flow", async () => {
		const prepareRestoreAction = vi.fn(async () => ({
			success: true as const,
			data: {
				kind: "restore_started" as const,
				installationId: revokedInstId,
				routeId: "route-prev-1",
				provider: "slack" as const,
				endpointGeneration: 3,
				endpointState: "synced" as const,
				requiresCredentials: true,
				status: "candidate" as const,
				recoveryState: baseState,
			},
		}));

		renderPanel({ prepareRestoreAction });

		expect(screen.getByText("Previous Slack App")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Start restore & verify" }));

		await waitFor(() => {
			expect(prepareRestoreAction).toHaveBeenCalledWith({ installationId: revokedInstId });
		});
	});
});
