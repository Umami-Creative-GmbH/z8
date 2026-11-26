/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSwitchImpactPreview } from "@/lib/chat-installations/switch-lifecycle";
import { SlackSwitchReviewPanel } from "./slack-switch-review-panel";

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

const initialPreview: ChatSwitchImpactPreview = {
	organizationId: "org-1",
	provider: "slack",
	generatedAt: "2026-11-26T12:00:00.000Z",
	switchControlEnabled: true,
	blockers: [],
	hasHardBlockers: false,
	currentInstallations: [
		{
			id: "22222222-2222-4222-8222-222222222222",
			status: "legacy_active",
			credentialSource: "deployment_managed",
			externalAppId: null,
			externalBotId: "U_OLD",
			externalBotUsername: null,
			externalDisplayName: "Legacy Slack",
			externalSpaceId: "T_ORG",
			externalSpaceName: "Acme",
			activeCredentialRevisionId: null,
			legacyTable: "slack_workspace_config",
			legacyRecordId: "44444444-4444-4444-8444-444444444444",
			verificationState: "unverified",
			lastVerifiedAt: null,
		},
	],
	primaryCurrentInstallationId: "22222222-2222-4222-8222-222222222222",
	primaryCurrentCredentialRevisionId: null,
	candidateInstallation: {
		id: "11111111-1111-4111-8111-111111111111",
		status: "candidate",
		credentialSource: "organization_owned",
		externalAppId: "A_NEW",
		externalBotId: "U_NEW",
		externalBotUsername: "z8-acme",
		externalDisplayName: "Z8 Acme",
		externalSpaceId: "T_ORG",
		externalSpaceName: "Acme",
		activeCredentialRevisionId: "33333333-3333-4333-8333-333333333333",
		legacyTable: null,
		legacyRecordId: null,
		verificationState: "verified",
		lastVerifiedAt: "2026-11-26T12:00:00.000Z",
	},
	candidateReady: true,
	candidateVerificationState: "verified",
	retiringInstallations: [
		{
			id: "55555555-5555-4555-8555-555555555555",
			credentialSource: "deployment_managed",
			externalAppId: null,
			externalDisplayName: "Prior Slack",
			externalSpaceName: "Acme Prior",
			retirementDeadlineAt: "2026-12-26T12:00:00.000Z",
			openCanonicalCards: 2,
			openLegacyOwnerCards: 0,
			outstandingRefreshWork: 1,
			pendingLegacyCards: 0,
			totalOutstandingCardsAndWork: 3,
		},
	],
	employeeImpact: {
		totalActiveEmployees: 5,
		verifiedReachableEmployees: 1,
		actionNeededEmployees: 2,
		unknownReachabilityEmployees: 2,
		carryForwardIdentityEmployees: 2,
		unreadyEmployees: 4,
	},
	approvalImpact: {
		openCanonicalCards: 2,
		openLegacyOwnerCards: 0,
		outstandingDeliveryWork: 1,
		outstandingRefreshWork: 1,
		uncertainApprovalWork: 0,
		pendingLegacyCards: 1,
		totalOutstanding: 4,
	},
	inFlightNotificationImpact: {
		total: 1,
		intentRecorded: 1,
		reconciliationRequired: 0,
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
};

function renderPanel(props: Partial<Parameters<typeof SlackSwitchReviewPanel>[0]> = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<SlackSwitchReviewPanel
				initialPreview={initialPreview}
				refreshPreviewAction={vi.fn(async () => ({ success: true as const, data: initialPreview }))}
				confirmSwitchAction={vi.fn(async () => ({
					success: false as const,
					error: "changed",
					code: "ValidationError",
					refusal: "impact_changed",
				}))}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

describe("SlackSwitchReviewPanel (#2045)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows reachability counts, retirement deadline & card count, and requires acknowledgment for unready employees", () => {
		renderPanel();

		expect(screen.getByText("Verified reachable")).toBeTruthy();
		expect(screen.getByText("Employee action needed")).toBeTruthy();
		expect(screen.getByText("Unknown reachability")).toBeTruthy();
		expect(screen.getByText("Retiring Slack installations")).toBeTruthy();
		expect(screen.getByText(/3 open cards \/ jobs/i)).toBeTruthy();
		expect(screen.getByText(/2026-12-26T12:00:00.000Z/)).toBeTruthy();

		const confirmBtn = screen.getByRole("button", {
			name: "Confirm switch to verified Slack app",
		}) as HTMLButtonElement;
		expect(confirmBtn.disabled).toBe(true);

		const checkbox = screen.getByRole("checkbox");
		fireEvent.click(checkbox);
		expect(confirmBtn.disabled).toBe(false);
	});

	it("announces impact_changed in aria-live region, moves focus to the updated impact summary, and requires fresh confirmation", async () => {
		const updatedPreview: ChatSwitchImpactPreview = {
			...initialPreview,
			generatedAt: "2026-11-26T12:05:00.000Z",
			impactDigest: "b".repeat(64),
			approvalImpact: {
				...initialPreview.approvalImpact,
				openCanonicalCards: 7,
				totalOutstanding: 9,
			},
		};

		const confirmSwitchAction = vi
			.fn()
			.mockResolvedValueOnce({
				success: false as const,
				error: "Impact changed",
				code: "ValidationError",
				refusal: "impact_changed",
				details: { preview: updatedPreview },
			})
			.mockResolvedValueOnce({
				success: true as const,
				data: {
					kind: "switched" as const,
					activeInstallationId: initialPreview.candidateInstallation!.id,
					retiredInstallationIds: [initialPreview.primaryCurrentInstallationId!],
					retirementDeadlineAt: "2026-12-26T12:05:00.000Z",
					carriedForwardIdentityCount: 2,
					promotedEnrollmentCount: 0,
					effectiveSettings: updatedPreview.effectiveSettings,
					preview: { ...updatedPreview, candidateInstallation: null },
				},
			});

		renderPanel({ confirmSwitchAction });

		// Acknowledge unready employees and submit first confirmation
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByRole("button", { name: "Confirm switch to verified Slack app" }));

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toMatch(
				/Impact or installation revisions changed since your review/i,
			);
		});

		// Live region announces the drift
		expect(screen.getByRole("status").textContent).toMatch(
			/Impact or installation revisions changed since your review/i,
		);

		// Focus moved to the updated impact summary container!
		await waitFor(() => {
			expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
			expect(document.activeElement?.textContent).toContain("2026-11-26T12:05:00.000Z");
		});

		// Checkbox was reset so fresh confirmation is required
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		const confirmBtn = screen.getByRole("button", {
			name: "Confirm switch to verified Slack app",
		}) as HTMLButtonElement;
		expect(confirmBtn.disabled).toBe(true);

		// Fresh acknowledgment + fresh confirmation submits with the updated digest!
		fireEvent.click(checkbox);
		fireEvent.click(confirmBtn);

		await waitFor(() => {
			expect(confirmSwitchAction).toHaveBeenCalledTimes(2);
		});
		expect(confirmSwitchAction).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				reviewedImpactDigest: "b".repeat(64),
				acknowledgeUnreadyEmployees: true,
			}),
		);
	});
});
