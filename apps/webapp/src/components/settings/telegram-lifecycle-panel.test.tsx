// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TelegramLifecycleState } from "@/app/[locale]/(app)/settings/notification-channels/telegram-lifecycle-actions";
import { TelegramLifecyclePanel } from "./telegram-lifecycle-panel";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string>) => {
			let text = defaultValue ?? _key;
			if (params) {
				for (const [k, v] of Object.entries(params)) {
					text = text.replace(`{${k}}`, v);
				}
			}
			return text;
		},
	}),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

function makeState(overrides?: Partial<TelegramLifecycleState>): TelegramLifecycleState {
	const candidateId = "00000000-0000-4000-8000-000000000010";
	const revId = "00000000-0000-4000-8000-000000000020";
	return {
		candidateSetup: {
			installationId: candidateId,
			organizationId: "org-1",
			routeId: "tg-route-1",
			status: "candidate",
			verificationState: "pending",
			readyForSwitch: false,
			externalBotId: "777001",
			externalBotUsername: "z8_new_bot",
			externalDisplayName: "Z8 New Bot",
			hasStoredCredentials: true,
			credentialRevisionNumber: 1,
			webhookUrl: "https://app.example.com/api/telegram/installations/tg-route-1/webhook",
			webhookRegistered: true,
			endpointGeneration: 1,
			endpointState: "synced",
			steps: {
				identity: {
					status: "passed",
					verifiedAt: "2026-11-26T10:00:00.000Z",
					expiresAt: null,
					detail: "@z8_new_bot (#777001)",
					failureCode: null,
				},
				webhookReceipt: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: "webhook_registered_awaiting_event",
					failureCode: null,
				},
				commandRegistration: {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: "telegram_429",
				},
				privateDelivery: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				},
			},
			lastVerifiedAt: null,
			updatedAt: "2026-11-26T10:00:00.000Z",
		},
		switchPreview: {
			organizationId: "org-1",
			provider: "telegram",
			generatedAt: "2026-11-26T10:00:00.000Z",
			switchControlEnabled: true,
			blockers: [],
			hasHardBlockers: false,
			currentInstallations: [],
			primaryCurrentInstallationId: null,
			primaryCurrentCredentialRevisionId: null,
			candidateInstallation: {
				id: candidateId,
				status: "candidate",
				credentialSource: "organization_owned",
				externalAppId: null,
				externalBotId: "777001",
				externalBotUsername: "z8_new_bot",
				externalDisplayName: "Z8 New Bot",
				externalSpaceId: null,
				externalSpaceName: null,
				activeCredentialRevisionId: revId,
				legacyTable: null,
				legacyRecordId: null,
				verificationState: "verified",
				lastVerifiedAt: "2026-11-26T10:00:00.000Z",
			},
			candidateReady: true,
			candidateVerificationState: "verified",
			retiringInstallations: [],
			employeeImpact: {
				totalActiveEmployees: 3,
				verifiedReachableEmployees: 1,
				actionNeededEmployees: 2,
				unknownReachabilityEmployees: 0,
				carryForwardIdentityEmployees: 0,
				unreadyEmployees: 2,
			},
			approvalImpact: {
				openCanonicalCards: 1,
				openLegacyOwnerCards: 0,
				outstandingDeliveryWork: 0,
				outstandingRefreshWork: 0,
				uncertainApprovalWork: 0,
				pendingLegacyCards: 0,
				totalOutstanding: 1,
			},
			inFlightNotificationImpact: {
				intentRecorded: 0,
				reconciliationRequired: 0,
				closedUnknown: 0,
			},
			effectiveSettings: {
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "UTC",
				escalationTimeoutHours: 24,
			},
			requiresUnreadyAcknowledgement: true,
			canConfirm: true,
			impactDigest: "a".repeat(64),
		},
		recoveryState: {
			organizationId: "org-1",
			provider: "telegram",
			activeInstallation: null,
			restorableInstallations: [],
			restoreCandidateSetup: null,
			restoreCandidatePreview: null,
			pendingCleanupJobs: [],
			rotationGuidance: {
				provider: "telegram",
				hasProviderInterruption: true,
				interruptionKind: "bot_token_cutover",
				summary: "Same-bot token rotation preserves the Telegram installation.",
				interruptionDetails: "Revoking the token stops outbound calls until saved.",
				verificationSteps: ["Rotate in BotFather", "Save in Z8"],
			},
		},
		...overrides,
	};
}

describe("TelegramLifecyclePanel", () => {
	it("shows the 4 verification steps separately, retries command registration, and focuses impact summary on drift", async () => {
		const initial = makeState();
		const retryCommandsAction = vi.fn(async () => ({
			success: true as const,
			data: {
				...initial,
				candidateSetup: {
					...initial.candidateSetup!,
					steps: {
						...initial.candidateSetup!.steps,
						commandRegistration: {
							status: "passed" as const,
							verifiedAt: "2026-11-26T10:05:00.000Z",
							expiresAt: null,
							detail: "11 commands",
							failureCode: null,
						},
					},
				},
			},
		}));

		const confirmSwitchAction = vi.fn(async () => ({
			success: false as const,
			error: "Impact changed",
			code: "ValidationError",
			refusal: "impact_changed",
			details: {
				preview: {
					...initial.switchPreview,
					impactDigest: "b".repeat(64),
				},
			},
		}));

		const qc = new QueryClient();
		render(
			<QueryClientProvider client={qc}>
				<TelegramLifecyclePanel
					initialState={initial}
					refreshAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					prepareAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					saveCredentialsAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					retryWebhookAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					retryCommandsAction={retryCommandsAction}
					sendPrivateTestAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					confirmSwitchAction={confirmSwitchAction}
					rotateCredentialsAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					revokeAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					prepareRestoreAction={vi.fn(async () => ({ success: true as const, data: initial }))}
					confirmRestoreAction={vi.fn(async () => ({ success: true as const, data: initial }))}
				/>
			</QueryClientProvider>,
		);

		expect(screen.getByText("1. Bot identity")).toBeTruthy();
		expect(screen.getByText("2. Authenticated webhook receipt")).toBeTruthy();
		expect(screen.getByText("3. Command registration")).toBeTruthy();
		expect(screen.getByText("4. Private delivery")).toBeTruthy();

		// Retry command registration independently
		fireEvent.click(screen.getByRole("button", { name: "Retry command registration" }));
		await waitFor(() => {
			expect(retryCommandsAction).toHaveBeenCalledWith({
				installationId: initial.candidateSetup!.installationId,
			});
		});

		// Acknowledge unready employees and trigger stale impact drift
		const ackCheckbox = screen.getByRole("checkbox");
		fireEvent.click(ackCheckbox);
		fireEvent.click(screen.getByRole("button", { name: "Confirm switch" }));

		await waitFor(() => {
			expect(confirmSwitchAction).toHaveBeenCalledTimes(1);
			expect(screen.getByRole("alert").textContent).toContain(
				"Switch impact or installation revisions changed",
			);
		});
	});
});
