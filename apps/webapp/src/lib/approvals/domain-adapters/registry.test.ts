import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalWorkflowSourceMap,
	ApprovalWorkflowType,
} from "../workflow/ports";
import {
	type AbsenceApprovalSource,
	createAbsenceApprovalAdapter,
} from "./absence.adapter";
import { createProductionApprovalDomainAdapterRegistry } from "./production-registry";
import * as registryModule from "./registry";
import {
	createApprovalDomainAdapterRegistry,
	isApprovedCancellationAuthorization,
} from "./registry";
import type {
	ApprovalDomainAdapter,
	ApprovalDomainAdapterContext,
} from "./types";
import type { OrdinaryWorkPeriodApprovalSource } from "./work-period-contract";

const organizationId = "org-1";
const workflowId = "10000000-0000-4000-8000-000000000001";
const sourceId = "60000000-0000-4000-8000-000000000001";

function adapter<Type extends ApprovalWorkflowType>(
	workflowType: Type,
	canCancelAfterApproval: boolean,
): ApprovalDomainAdapter<ApprovalWorkflowSourceMap[Type]> {
	return {
		workflowType,
		sourceType: `${workflowType}_source`,
		loadSource: async () => ({}),
		getTrustedCapabilities: async () => ({ canCancelAfterApproval }),
		produceRoutingContext: async () => ({}),
		preflightCommand: async () => undefined,
		preflightTerminal: async (_input) => undefined,
		finalizeTerminal: async (_input) => {
			throw new Error("not used");
		},
		projectDisplay: async () => ({ displayPayload: {}, searchText: "" }),
	};
}

function completeAdapters() {
	return {
		absence: adapter("absence", true),
		time_correction: adapter("time_correction", false),
		manual_time_submission: adapter("manual_time_submission", false),
		policy_clock_out: adapter("policy_clock_out", false),
		travel_expense: adapter("travel_expense", false),
		shift_request: adapter("shift_request", false),
		compliance_exception: adapter("compliance_exception", false),
	};
}

function context<Type extends ApprovalWorkflowType>(
	workflowType: Type,
): ApprovalDomainAdapterContext<ApprovalWorkflowSourceMap[Type]> {
	const sourceType = `${workflowType}_source`;
	return {
		organizationId,
		workflow: {
			id: workflowId,
			organizationId,
			workflowType,
			sourceType,
			sourceId,
		} as never,
		sourceIdentity: {
			organizationId,
			workflowType,
			sourceType,
			sourceId,
		},
		source: {},
		actor: { kind: "system", employeeId: null, userId: null },
	};
}

describe("approval domain adapter registry", () => {
	it("rejects a production absence lookalike with the wrong source alias", () => {
		expect(() =>
			createProductionApprovalDomainAdapterRegistry({
				absence: {
					...adapter("absence", true),
					sourceType: "absence_entry_copy",
				},
				timeCorrection: adapter("time_correction", false),
				manualTimeSubmission: {
					...adapter("manual_time_submission", false),
					sourceType: "time_entry",
				} as ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>,
				policyClockOut: {
					...adapter("policy_clock_out", false),
					sourceType: "time_entry",
				} as ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>,
			}),
		).toThrow(/registration/i);
	});

	it("issues cancellation authorization through the concrete eligible absence adapter", async () => {
		const concrete = createAbsenceApprovalAdapter({
			clock: { nowInstant: () => parseInstant("2026-07-18T09:00:00Z") },
			finalizeAbsenceTerminal: async () => ({}),
			deleteCancelledAbsence: async () => undefined,
		});
		const registry = createProductionApprovalDomainAdapterRegistry({
			absence: concrete,
			timeCorrection: {
				...adapter("time_correction", false),
				sourceType: "time_entry",
			},
			manualTimeSubmission: {
				...adapter("manual_time_submission", false),
				sourceType: "time_entry",
			} as ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>,
			policyClockOut: {
				...adapter("policy_clock_out", false),
				sourceType: "time_entry",
			} as ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>,
		});
		const absenceContext = {
			...context("absence"),
			workflow: {
				...context("absence").workflow,
				sourceType: "absence_entry",
				status: "approved",
				requesterEmployeeId: "emp-1",
			},
			sourceIdentity: {
				...context("absence").sourceIdentity,
				sourceType: "absence_entry",
			},
			actor: { kind: "employee", employeeId: "emp-1", userId: "user-1" },
			source: {
				id: sourceId,
				organizationId,
				employeeId: "emp-1",
				requesterUserId: "user-1",
				categoryId: "category-1",
				canonicalRecordId: "record-1",
				approvalWorkflowId: workflowId,
				startDate: "2026-07-19",
				startPeriod: "full_day",
				endDate: "2026-07-20",
				endPeriod: "full_day",
				status: "approved",
				notes: null,
				approvedBy: "emp-2",
				rejectionReason: null,
				requesterName: "Requester",
				teamId: null,
				categoryName: "Vacation",
				categoryType: "vacation",
				categoryColor: null,
				organizationTimezone: "Europe/Berlin",
			} satisfies AbsenceApprovalSource,
		} as ApprovalDomainAdapterContext<AbsenceApprovalSource>;

		const token = await registry.authorizeApprovedCancellation(absenceContext);
		expect(
			isApprovedCancellationAuthorization(token, {
				organizationId,
				workflowId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
			}),
		).toBe(true);
		expect(
			isApprovedCancellationAuthorization(
				{ ...token },
				{
					organizationId,
					workflowId,
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId,
				},
			),
		).toBe(false);
	});

	it("exports no raw capability issuer", () => {
		expect(
			Object.keys(registryModule).filter((name) =>
				/(mint|register|issue).*approved.*cancellation/i.test(name),
			),
		).toEqual([]);
	});

	it("selects the registered adapter and mints an exactly scoped token", async () => {
		const registry = createApprovalDomainAdapterRegistry(completeAdapters());
		const token = await registry.authorizeApprovedCancellation(
			context("absence"),
		);

		expect(registry.get("absence").workflowType).toBe("absence");
		expect(
			isApprovedCancellationAuthorization(token, {
				organizationId,
				workflowId,
				workflowType: "absence",
				sourceType: "absence_source",
				sourceId,
			}),
		).toBe(true);
		expect(Reflect.ownKeys(token)).toEqual([]);
	});

	it("rejects unsupported adapters and mismatched workflow context", async () => {
		const registry = createApprovalDomainAdapterRegistry(completeAdapters());
		await expect(
			registry.authorizeApprovedCancellation(context("time_correction")),
		).rejects.toThrow(/not authorized/i);

		const wrongOrganization = context("absence");
		wrongOrganization.sourceIdentity.organizationId = "org-2";
		await expect(
			registry.authorizeApprovedCancellation(wrongOrganization),
		).rejects.toThrow(/context/i);

		const wrongSource = context("absence");
		wrongSource.sourceIdentity.sourceType = "forged_source";
		await expect(
			registry.authorizeApprovedCancellation(wrongSource),
		).rejects.toThrow(/context/i);
	});

	it("rejects incomplete or mis-keyed adapter maps at runtime", () => {
		expect(() =>
			createApprovalDomainAdapterRegistry({
				absence: adapter("absence", true),
			} as never),
		).toThrow(/registration/i);
		expect(() =>
			createApprovalDomainAdapterRegistry({
				...completeAdapters(),
				absence: adapter("time_correction", true),
			} as never),
		).toThrow(/registration/i);
	});

	it("rejects copied, inherited, and wrong-scope tokens", async () => {
		const registry = createApprovalDomainAdapterRegistry(completeAdapters());
		const token = await registry.authorizeApprovedCancellation(
			context("absence"),
		);
		const scope = {
			organizationId,
			workflowId,
			workflowType: "absence" as const,
			sourceType: "absence_source",
			sourceId,
		};

		for (const forged of [
			{},
			{ ...token },
			Object.defineProperties({}, Object.getOwnPropertyDescriptors(token)),
			Object.create(token),
		]) {
			expect(isApprovedCancellationAuthorization(forged, scope)).toBe(false);
		}
		expect(
			isApprovedCancellationAuthorization(token, {
				organizationId: "org-2",
				workflowId,
				workflowType: "absence",
				sourceType: "absence_source",
				sourceId,
			}),
		).toBe(false);
	});

	it.each([
		["workflow type", { workflowType: "time_correction" }],
		["source type", { sourceType: "forged_source" }],
		["source ID", { sourceId: "60000000-0000-4000-8000-000000000002" }],
	])("rejects token replay against a different %s", async (_label, override) => {
		const registry = createApprovalDomainAdapterRegistry(completeAdapters());
		const sourceContext = context("absence");
		const token = await registry.authorizeApprovedCancellation(sourceContext);

		expect(
			isApprovedCancellationAuthorization(token, {
				organizationId,
				workflowId,
				workflowType: "absence",
				sourceType: "absence_source",
				sourceId,
				...override,
			} as never),
		).toBe(false);
	});
});
