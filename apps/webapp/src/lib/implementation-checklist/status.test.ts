import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_CHECKLIST_ITEMS } from "./definition";
import type { GoLiveCheckResult } from "./go-live/types";
import { resolveImplementationChecklistItems, summarizeImplementationChecklist } from "./status";

const workPolicyResult = (overrides: Partial<GoLiveCheckResult> = {}): GoLiveCheckResult =>
	({
		checkId: "work-policy",
		itemId: "work-policies",
		severity: "mandatory",
		checkedMemberCount: 3,
		outcome: "passed",
		configured: true,
		failures: [],
		warnings: [],
		notes: [],
		...overrides,
	}) as GoLiveCheckResult;

describe("implementation checklist status resolver", () => {
	it("keeps the expected customer go-live checklist order", () => {
		expect(IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => item.id)).toEqual([
			"organization-structure",
			"holidays",
			"work-policies",
			"approval-rules",
			"payroll-readiness",
			"integrations",
			"notifications",
			"employee-import",
		]);
	});

	it("exposes translation keys while preserving fallback copy", () => {
		expect(IMPLEMENTATION_CHECKLIST_ITEMS[0]).toMatchObject({
			title: "Organization structure",
			description: "Confirm members, teams, and responsibility boundaries before rollout.",
			titleKey: "settings.implementationChecklist.items.organizationStructure.title",
			descriptionKey: "settings.implementationChecklist.items.organizationStructure.description",
		});
	});

	it("classifies every item for go-live readiness", () => {
		expect(
			Object.fromEntries(IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => [item.id, item.role])),
		).toEqual({
			"organization-structure": "manual-only",
			holidays: "informational",
			"work-policies": "mandatory",
			"approval-rules": "manual-only",
			"payroll-readiness": "manual-only",
			integrations: "informational",
			notifications: "informational",
			"employee-import": "informational",
		});
	});

	it("maps presence detection onto configured and not set up", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays", "employee-import"]),
			manualCompleteIds: new Set(),
		});

		expect(items.find((item) => item.id === "holidays")).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
		expect(items.find((item) => item.id === "employee-import")).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
		expect(items.find((item) => item.id === "integrations")).toMatchObject({
			status: "not-set-up",
			completionSource: null,
		});
	});

	it("uses manual completion only for manually completable items", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["organization-structure", "approval-rules", "holidays"]),
		});

		expect(items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "configured",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "approval-rules")).toMatchObject({
			status: "configured",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "holidays")).toMatchObject({
			status: "not-set-up",
			completionSource: null,
			canToggleManualCompletion: false,
		});
	});

	it("prefers automatic completion over stale manual state", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["integrations"]),
			manualCompleteIds: new Set(["integrations"]),
		});

		expect(items.find((item) => item.id === "integrations")).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
	});

	it("ignores detector output for manual-only items", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["approval-rules", "payroll-readiness"]),
			manualCompleteIds: new Set(["approval-rules"]),
		});

		expect(items.find((item) => item.id === "approval-rules")).toMatchObject({
			status: "configured",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "payroll-readiness")).toMatchObject({
			status: "not-set-up",
			completionSource: null,
			canToggleManualCompletion: true,
		});
	});

	it("takes a go-live item's status from its check, never from settings presence", () => {
		const verified = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["work-policies"]),
			manualCompleteIds: new Set(),
			goLiveResults: [workPolicyResult()],
		});
		expect(verified.find((item) => item.id === "work-policies")).toMatchObject({
			status: "verified",
			goLive: { checkId: "work-policy", outcome: "passed" },
		});

		const unchecked = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["work-policies"]),
			manualCompleteIds: new Set(),
			goLiveResults: [workPolicyResult({ outcome: "unavailable" } as Partial<GoLiveCheckResult>)],
		});
		expect(unchecked.find((item) => item.id === "work-policies")).toMatchObject({
			status: "unavailable",
			completionSource: null,
		});
	});

	it("stops counting a confirmation whose settings changed, and keeps it on the item", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["organization-structure", "approval-rules"]),
			manualConfirmations: new Map([
				["organization-structure", { confirmedAt: "2026-10-30T09:00:00Z", freshness: "stale" }],
				["approval-rules", { confirmedAt: "2026-10-30T09:00:00Z", freshness: "current" }],
			]),
		});

		expect(items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "not-set-up",
			completionSource: null,
			canToggleManualCompletion: true,
			countsTowardProgress: false,
			manualConfirmation: { confirmedAt: "2026-10-30T09:00:00Z", freshness: "stale" },
		});
		expect(items.find((item) => item.id === "approval-rules")).toMatchObject({
			status: "configured",
			completionSource: "manual",
			countsTowardProgress: true,
			manualConfirmation: { freshness: "current" },
		});
		expect(summarizeImplementationChecklist(items).completedCount).toBe(1);
	});

	it("keeps counting a confirmation made before change tracking", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["payroll-readiness"]),
			manualConfirmations: new Map([
				[
					"payroll-readiness",
					{ confirmedAt: "2026-01-05T08:00:00Z", freshness: "before-change-tracking" },
				],
			]),
		});

		expect(items.find((item) => item.id === "payroll-readiness")).toMatchObject({
			status: "configured",
			completionSource: "manual",
			countsTowardProgress: true,
			manualConfirmation: { freshness: "before-change-tracking" },
		});
	});

	it("fails closed when Z8 couldn't check whether the settings changed", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["organization-structure"]),
			manualConfirmations: new Map([
				["organization-structure", { confirmedAt: "2026-10-30T09:00:00Z", freshness: "unchecked" }],
			]),
		});

		expect(items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "not-set-up",
			countsTowardProgress: false,
			manualConfirmation: { freshness: "unchecked" },
		});
	});

	it("keeps a go-live item's status but drops a stale confirmation as its completion source", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["approval-rules"]),
			manualConfirmations: new Map([
				["approval-rules", { confirmedAt: "2026-10-30T09:00:00Z", freshness: "stale" }],
			]),
			goLiveResults: [workPolicyResult({ checkId: "approver", itemId: "approval-rules" })],
		});

		expect(items.find((item) => item.id === "approval-rules")).toMatchObject({
			status: "verified",
			completionSource: "automatic",
			manualConfirmation: { freshness: "stale" },
		});
	});

	it("declares which configuration each confirmation's fingerprint covers", () => {
		expect(
			Object.fromEntries(
				IMPLEMENTATION_CHECKLIST_ITEMS.filter((item) => item.canManualComplete).map((item) => [
					item.id,
					item.confirmationCovers,
				]),
			),
		).toEqual({
			"organization-structure": "organization-structure",
			"approval-rules": "approval-rules",
			"payroll-readiness": "payroll-export",
		});
		expect(
			IMPLEMENTATION_CHECKLIST_ITEMS.filter((item) => !item.canManualComplete).every(
				(item) => item.confirmationCovers === null,
			),
		).toBe(true);
	});

	it("counts verified go-live items and configured other items toward progress", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays"]),
			manualCompleteIds: new Set(["approval-rules"]),
			goLiveResults: [workPolicyResult({ checkedMemberCount: 0 })],
		});

		expect(items.find((item) => item.id === "work-policies")?.status).toBe("configured");
		expect(summarizeImplementationChecklist(items)).toEqual({ completedCount: 2, totalCount: 8 });

		const verified = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays"]),
			manualCompleteIds: new Set(["approval-rules"]),
			goLiveResults: [workPolicyResult()],
		});
		expect(summarizeImplementationChecklist(verified)).toEqual({
			completedCount: 3,
			totalCount: 8,
		});
	});
});
