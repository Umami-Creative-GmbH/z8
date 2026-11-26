/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatConnectionsCard } from "@/components/notifications/chat-connections-card";
import { chatLinkCodeKey } from "@/hooks/use-member-chat-links";
import type { MemberChatChannelLinkView } from "@/lib/chat-installations/member-links";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

const baseProps = {
	hasOrganizationContext: true,
	channels: [] as MemberChatChannelLinkView[],
	isLoading: false,
	error: null as Error | null,
	isRetrying: false,
	onRetry: vi.fn(),
	generatedCodes: {},
	generatingCodeKey: null,
	onGenerateLinkCode: vi.fn(),
	recheckingDiscordInstallationId: null,
	onRecheckDiscordDm: vi.fn(),
	unlinkingProvider: null,
	onUnlink: vi.fn(),
};

describe("ChatConnectionsCard", () => {
	it("renders nothing when organization context is absent", () => {
		const { container } = render(
			<ChatConnectionsCard {...baseProps} hasOrganizationContext={false} />,
		);
		expect(container.textContent).toBe("");
	});

	it("renders Connected, Action needed, and Couldn't verify states for available channels", () => {
		const channels: MemberChatChannelLinkView[] = [
			{
				provider: "telegram",
				available: true,
				status: "connected",
				installationId: "inst-tg",
				installationLabel: "@z8_acme_bot",
				botUsername: "z8_acme_bot",
				externalUsername: "alice_tg",
				externalDisplayName: "Alice",
				canGenerateLinkCode: true,
				canUnlink: true,
				recoveryHint: null,
			},
			{
				provider: "slack",
				available: true,
				status: "action_needed",
				installationId: "inst-slack",
				installationLabel: "Acme Workspace",
				botUsername: null,
				externalUsername: null,
				externalDisplayName: null,
				canGenerateLinkCode: true,
				canUnlink: false,
				recoveryHint: "link_required",
			},
			{
				provider: "discord",
				available: true,
				status: "could_not_verify",
				installationId: "inst-discord",
				installationLabel: "Z8 Discord",
				botUsername: null,
				externalUsername: null,
				externalDisplayName: null,
				canGenerateLinkCode: false,
				canUnlink: false,
				recoveryHint: "installation_remediation",
			},
			{
				provider: "teams",
				available: false,
				status: "unavailable",
				installationId: null,
				installationLabel: null,
				botUsername: null,
				externalUsername: null,
				externalDisplayName: null,
				canGenerateLinkCode: false,
				canUnlink: false,
				recoveryHint: null,
			},
		];

		const onUnlink = vi.fn();
		render(<ChatConnectionsCard {...baseProps} channels={channels} onUnlink={onUnlink} />);

		expect(screen.getByText("Chat connections")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(screen.getByText("Action needed")).toBeTruthy();
		expect(screen.getByText("Couldn't verify")).toBeTruthy();
		expect(screen.getByText("Linked as @alice_tg")).toBeTruthy();
		expect(screen.queryByText("Microsoft Teams")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Unlink Telegram" }));
		expect(onUnlink).toHaveBeenCalledWith("telegram", "inst-tg");
	});

	it("supports generating and displaying short-lived link codes across Telegram, Slack, Teams, and Discord", () => {
		const onGenerateLinkCode = vi.fn();
		const onRecheckDiscordDm = vi.fn();
		const channels: MemberChatChannelLinkView[] = [
			{
				provider: "telegram",
				available: true,
				status: "action_needed",
				installationId: "inst-tg",
				installationLabel: "@z8_acme_bot",
				botUsername: "z8_acme_bot",
				externalUsername: null,
				externalDisplayName: null,
				canGenerateLinkCode: true,
				canUnlink: false,
				recoveryHint: "link_required",
			},
			{
				provider: "slack",
				available: true,
				status: "action_needed",
				installationId: "inst-slack",
				installationLabel: "Acme Slack",
				botUsername: null,
				externalUsername: null,
				externalDisplayName: null,
				canGenerateLinkCode: true,
				canUnlink: false,
				recoveryHint: "link_required",
			},
			{
				provider: "teams",
				available: true,
				status: "action_needed",
				installationId: "inst-teams",
				installationLabel: "Acme Teams",
				botUsername: null,
				externalUsername: null,
				externalDisplayName: null,
				canGenerateLinkCode: true,
				canUnlink: false,
				recoveryHint: "link_required",
			},
			{
				provider: "discord",
				available: true,
				status: "action_needed",
				installationId: "inst-discord",
				installationLabel: "Acme Discord",
				botUsername: null,
				externalUsername: "alice#1234",
				externalDisplayName: "Alice",
				canGenerateLinkCode: true,
				canUnlink: true,
				recoveryHint: "discord_enable_server_dms",
				reachabilityStatus: "action_needed",
				reachabilityReason: "discord_dm_blocked_50007",
				canRecheckDm: true,
			},
		];

		const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
		const { rerender } = render(
			<ChatConnectionsCard
				{...baseProps}
				channels={channels}
				onGenerateLinkCode={onGenerateLinkCode}
				onRecheckDiscordDm={onRecheckDiscordDm}
			/>,
		);

		const generateButtons = screen.getAllByRole("button", { name: "Generate link code" });
		expect(generateButtons).toHaveLength(4);
		fireEvent.click(generateButtons[0]);
		expect(onGenerateLinkCode).toHaveBeenCalledWith({
			provider: "telegram",
			purpose: "member_link",
			installationId: "inst-tg",
		});

		fireEvent.click(screen.getByRole("button", { name: "Verify DM delivery" }));
		expect(onRecheckDiscordDm).toHaveBeenCalledWith("inst-discord");
		expect(screen.getByRole("alert").textContent).toContain("50007");

		rerender(
			<ChatConnectionsCard
				{...baseProps}
				channels={channels}
				onGenerateLinkCode={onGenerateLinkCode}
				onRecheckDiscordDm={onRecheckDiscordDm}
				generatedCodes={{
					[chatLinkCodeKey("telegram", "member_link", "inst-tg")]: {
						code: "ABCD-EFGH-2345",
						expiresAt,
						installationId: "inst-tg",
						botUsername: "z8_acme_bot",
					},
					[chatLinkCodeKey("slack", "member_link", "inst-slack")]: {
						code: "SLCK-1234-5678",
						expiresAt,
						installationId: "inst-slack",
						botUsername: null,
					},
					[chatLinkCodeKey("teams", "member_link", "inst-teams")]: {
						code: "TEAM-1234-5678",
						expiresAt,
						installationId: "inst-teams",
						botUsername: null,
					},
					[chatLinkCodeKey("discord", "member_link", "inst-discord")]: {
						code: "DISC-1234-5678",
						expiresAt,
						installationId: "inst-discord",
						botUsername: null,
					},
				}}
			/>,
		);

		expect(screen.getByText("/link ABCD-EFGH-2345")).toBeTruthy();
		expect(screen.getByText("/z8 link SLCK-1234-5678")).toBeTruthy();
		expect(screen.getByText("link TEAM-1234-5678")).toBeTruthy();
		expect(screen.getByText("/link code:DISC-1234-5678")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Open @z8_acme_bot/i }).getAttribute("href")).toBe(
			"https://t.me/z8_acme_bot",
		);
	});

	it("shows Couldn't verify with retry when loading chat connections fails", () => {
		const onRetry = vi.fn();
		render(
			<ChatConnectionsCard {...baseProps} error={new Error("network failed")} onRetry={onRetry} />,
		);

		expect(screen.getByText("Couldn't verify")).toBeTruthy();
		expect(screen.getByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
