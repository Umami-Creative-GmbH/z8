/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInstallationInventoryCard } from "@/components/settings/chat-installation-inventory-card";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import type { ChatProviderInventory } from "@/lib/chat-installations/types";

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

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function makeInventory(overrides: Partial<ChatProviderInventory> = {}): ChatProviderInventory {
	return {
		provider: "slack",
		connectionState: "connected",
		switchEnabled: false,
		canSwitchOrMutateEndpoint: true,
		currentInstallations: [
			{
				id: "inst-1",
				organizationId: "org-1",
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "legacy_active",
				routeId: "route-1",
				externalAppId: "A12345",
				externalBotId: "U99999",
				externalBotUsername: null,
				externalDisplayName: "Acme Slack Workspace",
				externalSpaceId: "T12345",
				externalSpaceName: "Acme Slack Workspace",
				receiverScope: "slack-team:T12345",
				legacyTable: "slack_workspace_config",
				legacyRecordId: "legacy-1",
				legacyStatus: "active",
				remediationReason: null,
				remediationDetails: null,
				verificationState: "unverified",
				verificationEvidence: {
					source: "legacy_metadata",
					configuredAt: "2026-10-01T08:00:00.000Z",
					workspaceId: "T12345",
					botUserId: "U99999",
					secretStoreStatus: "available",
				},
				lastVerifiedAt: null,
				retirementDeadlineAt: null,
				retiredAt: null,
				revokedAt: null,
				endpointGeneration: 0,
				createdAt: "2026-10-01T08:00:00.000Z",
				updatedAt: "2026-10-01T08:00:00.000Z",
			},
		],
		candidateInstallations: [],
		retiringInstallations: [],
		blockers: [],
		effectiveSettings: {
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "Europe/Berlin",
			escalationTimeoutHours: 24,
		},
		teamsTenants: [],
		teamsSettingsDisagreements: [],
		...overrides,
	};
}

describe("ChatInstallationInventoryCard", () => {
	beforeEach(() => vi.clearAllMocks());

	it("shows external identity, credential source, and verification evidence for a connected installation", () => {
		renderWithQueryClient(
			<ChatInstallationInventoryCard
				provider="slack"
				channelName="Slack"
				initialInventory={makeInventory()}
				retryAction={vi.fn()}
			/>,
		);

		expect(screen.getByText("Acme Slack Workspace")).toBeTruthy();
		expect(screen.getByText("Deployment-managed")).toBeTruthy();
		expect(screen.getByText(/Unverified \(legacy\)/i)).toBeTruthy();
		expect(screen.getByText(/T12345/)).toBeTruthy();
		expect(screen.getByText(/U99999/)).toBeTruthy();
	});

	it("renders a distinct load error state with working retry instead of disconnected", async () => {
		const retryAction = vi.fn().mockResolvedValue({
			success: true,
			data: makeInventory({
				provider: "discord",
				currentInstallations: [
					{
						...makeInventory().currentInstallations[0]!,
						provider: "discord",
						credentialSource: "organization_owned",
						externalAppId: "123456789012345678",
						externalDisplayName: "123456789012345678",
					},
				],
			}),
		});

		renderWithQueryClient(
			<ChatInstallationInventoryCard
				provider="discord"
				channelName="Discord"
				initialInventory={null}
				initialLoadFailed
				retryAction={retryAction}
			/>,
		);

		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByText(/Could not load Discord installation/i)).toBeTruthy();
		expect(screen.queryByText(/No active Discord installation is connected/i)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

		await waitFor(() => expect(retryAction).toHaveBeenCalledTimes(1));
		expect(await screen.findByText("Organization-owned")).toBeTruthy();
		expect(screen.getByText("123456789012345678")).toBeTruthy();
	});

	it("distinguishes disconnected and unknown readiness states clearly", () => {
		const { rerender } = renderWithQueryClient(
			<ChatInstallationInventoryCard
				provider="telegram"
				channelName="Telegram"
				initialInventory={makeInventory({
					provider: "telegram",
					connectionState: "disconnected",
					currentInstallations: [],
					effectiveSettings: null,
				})}
				retryAction={vi.fn()}
			/>,
		);

		expect(screen.getByText("Disconnected")).toBeTruthy();
		expect(screen.getByText(/No active Telegram installation is connected/i)).toBeTruthy();

		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<ChatInstallationInventoryCard
					provider="telegram"
					channelName="Telegram"
					initialInventory={makeInventory({
						provider: "telegram",
						connectionState: "unknown_readiness",
						currentInstallations: [
							{
								...makeInventory().currentInstallations[0]!,
								provider: "telegram",
								credentialSource: "organization_owned",
								externalDisplayName: "Acme Bot",
								externalBotUsername: "acme_bot",
								verificationEvidence: {
									source: "legacy_metadata",
									secretStoreStatus: "missing",
								},
							},
						],
					})}
					retryAction={vi.fn()}
				/>
			</QueryClientProvider>,
		);

		expect(screen.getByText("Readiness unknown")).toBeTruthy();
		expect(screen.getByText("Organization-owned")).toBeTruthy();
		expect(screen.queryByText(/No active Telegram installation is connected/i)).toBeNull();
	});

	it("surfaces migration blockers with next actions and leaves legacy traffic notice visible", () => {
		renderWithQueryClient(
			<ChatInstallationInventoryCard
				provider="discord"
				channelName="Discord"
				initialInventory={makeInventory({
					provider: "discord",
					connectionState: "remediation_required",
					canSwitchOrMutateEndpoint: false,
					currentInstallations: [
						{
							...makeInventory().currentInstallations[0]!,
							provider: "discord",
							credentialSource: "organization_owned",
							status: "remediation_required",
							remediationReason: "duplicate_external_identity",
							externalAppId: "999999999999999999",
							externalDisplayName: "999999999999999999",
						},
					],
					blockers: [
						{
							code: "duplicate_external_identity",
							provider: "discord",
							installationId: "inst-1",
							legacyRecordId: "legacy-1",
							legacyStatus: "active",
							externalLabel: "999999999999999999",
							missingField: null,
							blocksSwitchAndEndpointMutation: true,
						},
					],
				})}
				retryAction={vi.fn()}
			/>,
		);

		expect(screen.getByText("Remediation required")).toBeTruthy();
		expect(screen.getByText(/Duplicate external app or bot identity/i)).toBeTruthy();
		expect(screen.getByText(/Current traffic continues on its existing route/i)).toBeTruthy();
	});

	it("lists every legacy Teams tenant, highlights unexpected historical statuses, and surfaces setting disagreements", () => {
		renderWithQueryClient(
			<ChatInstallationInventoryCard
				provider="teams"
				channelName="Microsoft Teams"
				initialInventory={makeInventory({
					provider: "teams",
					connectionState: "remediation_required",
					canSwitchOrMutateEndpoint: false,
					blockers: [
						{
							code: "unexpected_legacy_status",
							provider: "teams",
							installationId: "inst-t3",
							legacyRecordId: "legacy-t3",
							legacyStatus: "disabled",
							externalLabel: "Contoso Legacy",
							missingField: null,
							blocksSwitchAndEndpointMutation: true,
						},
						{
							code: "teams_tenant_settings_disagreement",
							provider: "teams",
							installationId: null,
							legacyRecordId: null,
							legacyStatus: null,
							externalLabel: null,
							missingField: null,
							blocksSwitchAndEndpointMutation: false,
						},
					],
					teamsTenants: [
						{
							id: "legacy-t1",
							tenantId: "aaaa1111-2222-4333-8444-555555555551",
							tenantName: "Contoso Europe",
							setupStatus: "active",
							isUnexpectedStatus: false,
							installationId: "inst-t1",
							installationStatus: "legacy_active",
							credentialSource: "deployment_managed",
							receiverScope: "teams-bot:app:tenant:aaaa1111-2222-4333-8444-555555555551",
							verificationState: "unverified",
							configuredAt: "2026-10-01T08:00:00.000Z",
							serviceUrlRecorded: true,
							effectiveSettings: {
								enableApprovals: true,
								enableCommands: true,
								enableDailyDigest: true,
								enableEscalations: true,
								digestTime: "08:00",
								digestTimezone: "Europe/Berlin",
								escalationTimeoutHours: 24,
							},
							blockers: [],
						},
						{
							id: "legacy-t2",
							tenantId: "aaaa1111-2222-4333-8444-555555555552",
							tenantName: "Contoso US",
							setupStatus: "disabled",
							isUnexpectedStatus: true,
							installationId: "inst-t2",
							installationStatus: "remediation_required",
							credentialSource: "deployment_managed",
							receiverScope: "teams-bot:app:tenant:aaaa1111-2222-4333-8444-555555555552",
							verificationState: "unverified",
							configuredAt: null,
							serviceUrlRecorded: false,
							effectiveSettings: {
								enableApprovals: false,
								enableCommands: true,
								enableDailyDigest: true,
								enableEscalations: true,
								digestTime: "09:30",
								digestTimezone: "America/New_York",
								escalationTimeoutHours: 12,
							},
							blockers: [
								{
									code: "unexpected_legacy_status",
									provider: "teams",
									installationId: "inst-t2",
									legacyRecordId: "legacy-t2",
									legacyStatus: "disabled",
									externalLabel: "Contoso US",
									missingField: null,
									blocksSwitchAndEndpointMutation: true,
								},
							],
						},
					],
					teamsSettingsDisagreements: [
						{
							field: "enableApprovals",
							values: [
								{
									tenantId: "aaaa1111-2222-4333-8444-555555555551",
									tenantName: "Contoso Europe",
									value: true,
								},
								{
									tenantId: "aaaa1111-2222-4333-8444-555555555552",
									tenantName: "Contoso US",
									value: false,
								},
							],
						},
					],
				})}
				retryAction={vi.fn()}
			/>,
		);

		expect(screen.getAllByText("Contoso Europe").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Contoso US").length).toBeGreaterThan(0);
		expect(screen.getByText(/Unexpected status: disabled/i)).toBeTruthy();
		expect(screen.getByText(/Settings disagree across legacy Teams tenants/i)).toBeTruthy();
	});

	it("keeps field IDs unique when multiple channel tabs are mounted simultaneously", () => {
		const baseConfig = {
			setupStatus: "active",
			displayName: "Connected",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "Europe/Berlin",
			escalationTimeoutHours: 24,
		};

		const { container } = renderWithQueryClient(
			<>
				<NotificationChannelSettings
					channelName="Slack"
					config={baseConfig}
					updateAction={vi.fn()}
				/>
				<NotificationChannelSettings
					channelName="Microsoft Teams"
					config={baseConfig}
					updateAction={vi.fn()}
				/>
				<NotificationChannelSettings
					channelName="Discord"
					config={baseConfig}
					updateAction={vi.fn()}
				/>
			</>,
		);

		const elementsWithIds = Array.from(container.querySelectorAll("[id]"));
		const ids = elementsWithIds.map((el) => el.getAttribute("id")).filter(Boolean);
		const uniqueIds = new Set(ids);
		expect(ids.length).toBeGreaterThan(0);
		expect(uniqueIds.size).toBe(ids.length);
	});
});
