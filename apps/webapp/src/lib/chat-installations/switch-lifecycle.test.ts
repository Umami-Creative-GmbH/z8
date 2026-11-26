import { describe, expect, it } from "vitest";
import {
	CHAT_INSTALLATION_RETIREMENT_DAYS,
	classifyEmployeeSwitchReachability,
	computeRetirementDeadline,
	computeSwitchImpactDigest,
	evaluateInstallationRetirementEligibility,
	hasMaterialSwitchImpactChanged,
	type SwitchImpactDigestInput,
} from "./switch-lifecycle";

const baseDigestInput: SwitchImpactDigestInput = {
	organizationId: "org-1",
	provider: "slack",
	currentInstallationIds: ["inst-old-1"],
	currentCredentialRevisionIds: ["inst-old-1:rev-old-1"],
	candidateInstallationId: "inst-new-1",
	candidateCredentialRevisionId: "rev-new-1",
	affectedLegacyIds: ["slack_workspace_config:legacy-1"],
	materialCounts: {
		totalActiveEmployees: 5,
		verifiedReachableEmployees: 1,
		actionNeededEmployees: 2,
		unknownReachabilityEmployees: 2,
		carryForwardIdentityEmployees: 2,
		outstandingApprovalCards: 3,
		outstandingApprovalWork: 1,
		pendingLegacyApprovalCards: 2,
		inFlightDurableDispatches: 1,
		uncertainDurableDispatches: 0,
	},
};

describe("chat installation switch lifecycle pure rules (#2045)", () => {
	it("computes a deterministic SHA-256 impact digest independent of array ordering", () => {
		const digestA = computeSwitchImpactDigest({
			...baseDigestInput,
			currentInstallationIds: ["inst-b", "inst-a"],
			currentCredentialRevisionIds: ["inst-b:rev-b", "inst-a:rev-a"],
			affectedLegacyIds: ["teams_tenant_config:t2", "teams_tenant_config:t1"],
		});
		const digestB = computeSwitchImpactDigest({
			...baseDigestInput,
			currentInstallationIds: ["inst-a", "inst-b"],
			currentCredentialRevisionIds: ["inst-a:rev-a", "inst-b:rev-b"],
			affectedLegacyIds: ["teams_tenant_config:t1", "teams_tenant_config:t2"],
		});

		expect(digestA).toMatch(/^[a-f0-9]{64}$/);
		expect(digestA).toBe(digestB);
	});

	it("changes the impact digest whenever revisions, affected installations, or material counts change", () => {
		const baseline = computeSwitchImpactDigest(baseDigestInput);

		expect(
			computeSwitchImpactDigest({
				...baseDigestInput,
				candidateCredentialRevisionId: "rev-new-2",
			}),
		).not.toBe(baseline);

		expect(
			computeSwitchImpactDigest({
				...baseDigestInput,
				currentCredentialRevisionIds: ["inst-old-1:rev-old-2"],
			}),
		).not.toBe(baseline);

		expect(
			computeSwitchImpactDigest({
				...baseDigestInput,
				materialCounts: {
					...baseDigestInput.materialCounts,
					outstandingApprovalCards: 4,
				},
			}),
		).not.toBe(baseline);

		expect(
			computeSwitchImpactDigest({
				...baseDigestInput,
				materialCounts: {
					...baseDigestInput.materialCounts,
					inFlightDurableDispatches: 2,
				},
			}),
		).not.toBe(baseline);

		expect(
			computeSwitchImpactDigest({
				...baseDigestInput,
				materialCounts: {
					...baseDigestInput.materialCounts,
					actionNeededEmployees: 3,
					verifiedReachableEmployees: 0,
				},
			}),
		).not.toBe(baseline);
	});

	it("detects stale confirmation inputs when current installation, revisions, or digest drift", () => {
		const digest = computeSwitchImpactDigest(baseDigestInput);

		expect(
			hasMaterialSwitchImpactChanged({
				reviewedCurrentInstallationId: "inst-old-1",
				reviewedCurrentInstallationIds: ["inst-old-1"],
				reviewedCurrentCredentialRevisionId: "rev-old-1",
				reviewedCandidateCredentialRevisionId: "rev-new-1",
				reviewedImpactDigest: digest,
				freshCurrentInstallationId: "inst-old-1",
				freshCurrentInstallationIds: ["inst-old-1"],
				freshCurrentCredentialRevisionId: "rev-old-1",
				freshCandidateCredentialRevisionId: "rev-new-1",
				freshImpactDigest: digest,
			}),
		).toBe(false);

		expect(
			hasMaterialSwitchImpactChanged({
				reviewedCurrentInstallationId: "inst-old-1",
				reviewedCurrentInstallationIds: ["inst-old-1"],
				reviewedCurrentCredentialRevisionId: "rev-old-1",
				reviewedCandidateCredentialRevisionId: "rev-new-1",
				reviewedImpactDigest: digest,
				freshCurrentInstallationId: "inst-old-1",
				freshCurrentInstallationIds: ["inst-old-1"],
				freshCurrentCredentialRevisionId: "rev-old-1",
				freshCandidateCredentialRevisionId: "rev-new-2",
				freshImpactDigest: digest,
			}),
		).toBe(true);

		expect(
			hasMaterialSwitchImpactChanged({
				reviewedCurrentInstallationId: "inst-old-1",
				reviewedCurrentInstallationIds: ["inst-old-1"],
				reviewedCurrentCredentialRevisionId: "rev-old-1",
				reviewedCandidateCredentialRevisionId: "rev-new-1",
				reviewedImpactDigest: digest,
				freshCurrentInstallationId: "inst-old-1",
				freshCurrentInstallationIds: ["inst-old-1"],
				freshCurrentCredentialRevisionId: "rev-old-1",
				freshCandidateCredentialRevisionId: "rev-new-1",
				freshImpactDigest: "0".repeat(64),
			}),
		).toBe(true);
	});

	it("classifies active employees into verifiedReachable, actionNeeded, and unknownReachability while tracking carry-forward identity", () => {
		const summary = classifyEmployeeSwitchReachability({
			activeUserIds: [
				"u-reachable",
				"u-carry",
				"u-candidate-unknown",
				"u-unreachable",
				"u-unlinked",
			],
			candidateConversationStatusByUser: new Map([
				["u-reachable", "reachable"],
				["u-candidate-unknown", "unknown"],
				["u-unreachable", "unreachable"],
			]),
			candidateLinkedUserIds: new Set(["u-reachable", "u-candidate-unknown"]),
			sameScopeCarryForwardUserIds: new Set(["u-carry", "u-reachable"]),
		});

		expect(summary).toEqual({
			totalActiveEmployees: 5,
			verifiedReachableEmployees: 1,
			actionNeededEmployees: 2,
			unknownReachabilityEmployees: 2,
			carryForwardIdentityEmployees: 1,
			unreadyEmployees: 4,
		});
	});

	it("computes an exact 30-day UTC retirement deadline using Temporal and evaluates retirement readiness", () => {
		const switchedAt = new Date("2026-11-26T12:00:00.000Z");
		const deadline = computeRetirementDeadline(switchedAt);
		expect(CHAT_INSTALLATION_RETIREMENT_DAYS).toBe(30);
		expect(deadline.toISOString()).toBe("2026-12-26T12:00:00.000Z");

		// Open cards remain and before deadline -> stay retiring
		expect(
			evaluateInstallationRetirementEligibility({
				retirementDeadlineAt: deadline,
				now: new Date("2026-12-10T00:00:00.000Z"),
				totalOutstandingApprovalWork: 2,
			}),
		).toEqual({ shouldRetire: false, reason: null });

		// Zero outstanding work before deadline -> retire early as work_settled
		expect(
			evaluateInstallationRetirementEligibility({
				retirementDeadlineAt: deadline,
				now: new Date("2026-12-01T00:00:00.000Z"),
				totalOutstandingApprovalWork: 0,
			}),
		).toEqual({ shouldRetire: true, reason: "work_settled" });

		// Open cards still exist at/after 30-day deadline -> retire as deadline_reached
		expect(
			evaluateInstallationRetirementEligibility({
				retirementDeadlineAt: deadline,
				now: new Date("2026-12-26T12:00:00.000Z"),
				totalOutstandingApprovalWork: 3,
			}),
		).toEqual({ shouldRetire: true, reason: "deadline_reached" });
	});
});
