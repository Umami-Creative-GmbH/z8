import { describe, expect, it } from "vitest";
import {
	buildProviderCapabilityDisclosure,
	mapPilotAdmissionToSupportMode,
} from "./capability-disclosure";

describe("chat provider capability & approval kind disclosures (#2045)", () => {
	it("maps pilot admission modes cleanly to UI support modes", () => {
		expect(mapPilotAdmissionToSupportMode("actionable")).toBe("in_chat_decision");
		expect(mapPilotAdmissionToSupportMode("review_only")).toBe("review_in_z8");
		expect(mapPilotAdmissionToSupportMode("unverified")).toBe("unverified");
	});

	it("reports Slack as review_in_z8 for canonical absence & time kinds and unverified for travel_expense and legacy kinds", () => {
		const disclosure = buildProviderCapabilityDisclosure({
			provider: "slack",
			effectiveSettings: {
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "Europe/Berlin",
				escalationTimeoutHours: 24,
			},
			authorityByWorkflowType: {
				absence: "canonical",
				travel_expense: "legacy",
				manual_time_submission: "canonical",
				policy_clock_out: "canonical",
				time_correction: "canonical",
			},
			deliveryActiveWorkflowTypes: new Set(["absence", "manual_time_submission"]),
			escalationPolicy: {
				enabled: true,
				responseWindowHours: 12,
			},
		});

		const byKind = Object.fromEntries(
			disclosure.approvalKinds.map((item) => [item.workflowType, item]),
		);

		expect(byKind.absence).toMatchObject({
			authority: "canonical",
			supportMode: "review_in_z8",
			deliveryActive: true,
		});
		expect(byKind.manual_time_submission).toMatchObject({
			authority: "canonical",
			supportMode: "review_in_z8",
			deliveryActive: true,
		});
		expect(byKind.policy_clock_out).toMatchObject({
			authority: "canonical",
			supportMode: "review_in_z8",
			deliveryActive: false,
		});
		expect(byKind.time_correction).toMatchObject({
			authority: "canonical",
			supportMode: "review_in_z8",
			deliveryActive: false,
		});
		expect(byKind.travel_expense).toMatchObject({
			authority: "legacy",
			supportMode: "unverified",
			deliveryActive: false,
		});

		// Escalation policy owns timing -> channel setting controls delivery only
		expect(disclosure.escalationPolicy).toEqual({
			policyOwned: true,
			policyEnabled: true,
			responseWindowHours: 12,
			channelControlsDeliveryOnly: true,
		});

		const approvalsCap = disclosure.capabilities.find((c) => c.capability === "approvals");
		expect(approvalsCap).toMatchObject({
			enabled: true,
			supported: true,
			noteCode: "slack_review_in_z8",
		});

		const escalationsCap = disclosure.capabilities.find((c) => c.capability === "escalations");
		expect(escalationsCap).toMatchObject({
			enabled: true,
			supported: true,
			noteCode: "escalation_policy_owns_timing",
		});
	});

	it("reports Telegram as in_chat_decision across canonical and legacy kinds, and Teams/Discord as in_chat_decision for canonical absence only", () => {
		const telegram = buildProviderCapabilityDisclosure({
			provider: "telegram",
			effectiveSettings: null,
			authorityByWorkflowType: {
				absence: "legacy",
				travel_expense: "legacy",
				manual_time_submission: "legacy",
				policy_clock_out: "canonical",
				time_correction: "canonical",
			},
			deliveryActiveWorkflowTypes: new Set(),
			escalationPolicy: null,
		});

		expect(telegram.approvalKinds.every((k) => k.supportMode === "in_chat_decision")).toBe(true);
		expect(telegram.escalationPolicy).toEqual({
			policyOwned: false,
			policyEnabled: null,
			responseWindowHours: null,
			channelControlsDeliveryOnly: false,
		});

		const teams = buildProviderCapabilityDisclosure({
			provider: "teams",
			effectiveSettings: null,
			authorityByWorkflowType: {
				absence: "canonical",
				travel_expense: "legacy",
				manual_time_submission: "canonical",
				policy_clock_out: "canonical",
				time_correction: "canonical",
			},
			deliveryActiveWorkflowTypes: new Set(["absence"]),
			escalationPolicy: null,
		});

		const teamsByKind = Object.fromEntries(
			teams.approvalKinds.map((item) => [item.workflowType, item.supportMode]),
		);
		expect(teamsByKind).toEqual({
			absence: "in_chat_decision",
			travel_expense: "unverified",
			manual_time_submission: "unverified",
			policy_clock_out: "unverified",
			time_correction: "unverified",
		});
	});
});
