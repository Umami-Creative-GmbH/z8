import { describe, expect, it, vi } from "vitest";
import type { ApprovalWorkflowType } from "../workflow/ports";
import {
	ApprovalDomainNotMigratedError,
	createProductionApprovalDomainAdapterRegistry,
} from "./production-registry";
import type { ApprovalDomainAdapter } from "./types";

const aliases = {
	manual_time_submission: "time_entry",
	policy_clock_out: "time_entry",
	travel_expense: "travel_expense_claim",
	shift_request: "shift_request",
	compliance_exception: "compliance_exception",
} as const;

describe("production approval domain adapter registry", () => {
	it("registers all four migrated adapters and three fail-closed domains", () => {
		const absence = {
			workflowType: "absence",
			sourceType: "absence_entry",
		} as ApprovalDomainAdapter<unknown>;
		const timeCorrection = {
			workflowType: "time_correction",
			sourceType: "time_entry",
		} as ApprovalDomainAdapter<unknown>;
		const manualTimeSubmission = {
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
		} as ApprovalDomainAdapter<unknown>;
		const policyClockOut = {
			workflowType: "policy_clock_out",
			sourceType: "time_entry",
		} as ApprovalDomainAdapter<unknown>;
		const registry = createProductionApprovalDomainAdapterRegistry({
			absence,
			timeCorrection,
			manualTimeSubmission,
			policyClockOut,
		});

		expect(registry.get("absence")).toBe(absence);
		expect(registry.get("time_correction")).toBe(timeCorrection);
		expect(registry.get("manual_time_submission")).toBe(manualTimeSubmission);
		expect(registry.get("policy_clock_out")).toBe(policyClockOut);
		for (const [workflowType, sourceType] of Object.entries(aliases).slice(2)) {
			expect(registry.get(workflowType as ApprovalWorkflowType)).toMatchObject({
				workflowType,
				sourceType,
			});
		}
	});

	it("fails every unmigrated operation before a database callback", async () => {
		const absence = {
			workflowType: "absence",
			sourceType: "absence_entry",
		} as ApprovalDomainAdapter<unknown>;
		const timeCorrection = {
			workflowType: "time_correction",
			sourceType: "time_entry",
		} as ApprovalDomainAdapter<unknown>;
		const registry = createProductionApprovalDomainAdapterRegistry({
			absence,
			timeCorrection,
			manualTimeSubmission: {
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
			} as ApprovalDomainAdapter<unknown>,
			policyClockOut: {
				workflowType: "policy_clock_out",
				sourceType: "time_entry",
			} as ApprovalDomainAdapter<unknown>,
		});
		const execute = vi.fn();
		const input = { dbService: { db: { execute } } } as never;

		for (const workflowType of Object.keys(aliases).slice(2) as Array<
			keyof typeof aliases
		>) {
			const adapter = registry.get(workflowType);
			for (const operation of [
				() => adapter.loadSource(input),
				() => adapter.getTrustedCapabilities(input),
				() => adapter.produceRoutingContext(input),
				() => adapter.preflightCommand(input),
				() => adapter.preflightTerminal(input),
				() => adapter.finalizeTerminal(input),
				() => adapter.projectDisplay(input),
			]) {
				await expect(operation()).rejects.toEqual(
					expect.objectContaining({
						name: "ApprovalDomainNotMigratedError",
						workflowType,
						sourceType: aliases[workflowType],
					}),
				);
			}
		}
		expect(execute).not.toHaveBeenCalled();
		expect(
			new ApprovalDomainNotMigratedError("shift_request", "shift_request")
				.message,
		).toBe(
			"Approval domain adapter is not migrated: shift_request/shift_request",
		);
	});

	it("rejects a time-correction lookalike with the wrong source alias", () => {
		expect(() =>
			createProductionApprovalDomainAdapterRegistry({
				absence: {
					workflowType: "absence",
					sourceType: "absence_entry",
				} as ApprovalDomainAdapter<unknown>,
				timeCorrection: {
					workflowType: "time_correction",
					sourceType: "work_period",
				} as ApprovalDomainAdapter<unknown>,
				manualTimeSubmission: {
					workflowType: "manual_time_submission",
					sourceType: "time_entry",
				} as ApprovalDomainAdapter<unknown>,
				policyClockOut: {
					workflowType: "policy_clock_out",
					sourceType: "time_entry",
				} as ApprovalDomainAdapter<unknown>,
			}),
		).toThrow(/registration/i);
	});
});
