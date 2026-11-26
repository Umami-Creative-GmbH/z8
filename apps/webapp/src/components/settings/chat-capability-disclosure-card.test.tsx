/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderCapabilityDisclosure } from "@/lib/chat-installations/capability-disclosure";
import { ChatCapabilityDisclosureCard } from "./chat-capability-disclosure-card";

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

describe("ChatCapabilityDisclosureCard (#2045)", () => {
	it("shows Review in Z8 for Slack approval kinds and explains escalation policy timing ownership", () => {
		const disclosure: ProviderCapabilityDisclosure = {
			provider: "slack",
			escalationPolicy: {
				policyOwned: true,
				policyEnabled: true,
				responseWindowHours: 16,
				channelControlsDeliveryOnly: true,
			},
			capabilities: [
				{ capability: "notifications", enabled: true, supported: true, noteCode: null },
				{ capability: "commands", enabled: true, supported: true, noteCode: null },
				{ capability: "daily_digest", enabled: false, supported: true, noteCode: null },
				{
					capability: "escalations",
					enabled: true,
					supported: true,
					noteCode: "escalation_policy_owns_timing",
				},
				{
					capability: "approvals",
					enabled: true,
					supported: true,
					noteCode: "slack_review_in_z8",
				},
			],
			approvalKinds: [
				{
					workflowType: "absence",
					authority: "canonical",
					supportMode: "review_in_z8",
					deliveryActive: true,
				},
				{
					workflowType: "travel_expense",
					authority: "legacy",
					supportMode: "unverified",
					deliveryActive: false,
				},
			],
		};

		render(<ChatCapabilityDisclosureCard channelName="Slack" disclosure={disclosure} />);

		expect(screen.getByText("Slack capabilities & approval support")).toBeTruthy();
		expect(screen.getByText("Review in Z8")).toBeTruthy();
		expect(screen.getByText("Unverified")).toBeTruthy();
		expect(
			screen.getByText(
				/approval escalation policy owns escalation timing \(16 h response window\)/i,
			),
		).toBeTruthy();
		expect(
			screen.getByText(/Slack approval cards link to Z8 for authenticated review/i),
		).toBeTruthy();
	});
});
