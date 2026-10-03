import { describe, expect, it, vi } from "vitest";
import { approvalWriteGateResult } from "../authority";
import {
	ApprovalWriteGateScopeMismatch,
	acquirePinnedApprovalContext,
	pinApprovalContext,
	pinApprovalWriteGate,
} from "./pinned-write-gate";
import type { ApprovalWriteGate, ApprovalWriteGateResult } from "./ports";

const authority: ApprovalWriteGateResult = approvalWriteGateResult("shadow");

function testContext() {
	const acquire = vi.fn<ApprovalWriteGate["acquire"]>().mockResolvedValue(authority);
	const rebound = { mirrorLegacyToCanonical: vi.fn() };
	const withWriteGate = vi.fn((_gate: ApprovalWriteGate) => rebound);
	return {
		context: {
			marker: "kept",
			writeGate: { acquire },
			compatibilityWriter: { withWriteGate },
		},
		acquire,
		withWriteGate,
		rebound,
	};
}

describe("pinApprovalWriteGate", () => {
	it("returns the pinned authority for its exact scope without acquiring", async () => {
		const gate = pinApprovalWriteGate({
			organizationId: "org-1",
			workflowType: "absence",
			authority,
		});

		await expect(gate.acquire({ organizationId: "org-1", workflowType: "absence" })).resolves.toBe(
			authority,
		);
	});

	it.each([
		["another organization", { organizationId: "org-2", workflowType: "absence" }],
		["another workflow type", { organizationId: "org-1", workflowType: "time_correction" }],
	] as const)("refuses %s", async (_name, scope) => {
		const gate = pinApprovalWriteGate({
			organizationId: "org-1",
			workflowType: "absence",
			authority,
		});

		await expect(gate.acquire(scope)).rejects.toBeInstanceOf(ApprovalWriteGateScopeMismatch);
	});

	it("throws the caller's refusal for a scope outside the pin", async () => {
		const refusal = new Error("caller refusal");
		const gate = pinApprovalWriteGate({
			organizationId: "org-1",
			workflowType: "absence",
			authority,
			refuse: () => {
				throw refusal;
			},
		});

		await expect(gate.acquire({ organizationId: "org-2", workflowType: "absence" })).rejects.toBe(
			refusal,
		);
	});

	it("checks the owner is still active before every read", async () => {
		let active = true;
		const gate = pinApprovalWriteGate({
			organizationId: "org-1",
			workflowType: "absence",
			authority,
			assertActive: () => {
				if (!active) throw new Error("settled");
			},
		});

		await expect(gate.acquire({ organizationId: "org-1", workflowType: "absence" })).resolves.toBe(
			authority,
		);
		active = false;
		await expect(
			gate.acquire({ organizationId: "org-1", workflowType: "absence" }),
		).rejects.toThrow("settled");
	});
});

describe("pinApprovalContext", () => {
	it("replaces the write gate and rebinds the compatibility writer to it", async () => {
		const { context, acquire, withWriteGate, rebound } = testContext();

		const pinned = pinApprovalContext(context, {
			organizationId: "org-1",
			workflowType: "absence",
			authority,
		});

		expect(pinned.marker).toBe("kept");
		expect(pinned.compatibilityWriter).toBe(rebound);
		expect(withWriteGate).toHaveBeenCalledExactlyOnceWith(pinned.writeGate);
		await expect(
			pinned.writeGate.acquire({ organizationId: "org-1", workflowType: "absence" }),
		).resolves.toBe(authority);
		expect(acquire).not.toHaveBeenCalled();
		expect(context.writeGate.acquire).toBe(acquire);
	});
});

describe("acquirePinnedApprovalContext", () => {
	it("acquires the gate once and pins its result", async () => {
		const { context, acquire, withWriteGate } = testContext();

		const pinned = await acquirePinnedApprovalContext(context, {
			organizationId: "org-1",
			workflowType: "time_correction",
		});

		expect(pinned.authority).toBe(authority);
		expect(acquire).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			workflowType: "time_correction",
		});
		expect(withWriteGate).toHaveBeenCalledExactlyOnceWith(pinned.context.writeGate);
		await expect(
			pinned.context.writeGate.acquire({
				organizationId: "org-1",
				workflowType: "time_correction",
			}),
		).resolves.toBe(authority);
		await expect(
			pinned.context.writeGate.acquire({ organizationId: "org-1", workflowType: "absence" }),
		).rejects.toBeInstanceOf(ApprovalWriteGateScopeMismatch);
		expect(acquire).toHaveBeenCalledOnce();
	});
});
