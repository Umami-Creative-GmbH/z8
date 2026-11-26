/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatConnectionsCard } from "@/components/notifications/chat-connections-card";
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
	generatedTelegramCode: null,
	isGeneratingTelegramCode: false,
	onGenerateTelegramCode: vi.fn(),
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
				canGenerateLinkCode: false,
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

	it("supports generating and displaying a short-lived Telegram link code with expiry", () => {
		const onGenerateTelegramCode = vi.fn();
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
		];

		const { rerender } = render(
			<ChatConnectionsCard
				{...baseProps}
				channels={channels}
				onGenerateTelegramCode={onGenerateTelegramCode}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Generate link code" }));
		expect(onGenerateTelegramCode).toHaveBeenCalledOnce();

		rerender(
			<ChatConnectionsCard
				{...baseProps}
				channels={channels}
				onGenerateTelegramCode={onGenerateTelegramCode}
				generatedTelegramCode={{
					code: "ABCD-EFGH-2345",
					expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
					installationId: "inst-tg",
					botUsername: "z8_acme_bot",
				}}
			/>,
		);

		expect(screen.getByText("/link ABCD-EFGH-2345")).toBeTruthy();
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
