import { describe, expect, it } from "vitest";
import {
	approvalAuthorityOf,
	approvalWriteGateResult,
	lifecycleModesWithAuthority,
	parseApprovalLifecycleMode,
	resolveApprovalAuthority,
} from "./resolution";

describe("approval authority resolution", () => {
	it.each([
		["legacy", "legacy", false, false],
		["shadow", "legacy", true, false],
		["ready", "legacy", true, false],
		["canonical", "canonical", false, true],
		["complete", "canonical", false, false],
	] as const)(
		"resolves %s to %s authority (shadow mirroring %s, compatibility writing %s)",
		(mode, authority, shadowMirroring, compatibilityWriting) => {
			expect(resolveApprovalAuthority(mode)).toEqual({
				mode,
				authority,
				shadowMirroring,
				compatibilityWriting,
			});
			expect(approvalWriteGateResult(mode)).toEqual({
				mode,
				authority,
				shadowMirroring,
				compatibilityWriting,
			});
			expect(approvalAuthorityOf(mode)).toBe(authority);
		},
	);

	it("resolves an organization without a rollout row to legacy authority", () => {
		expect(resolveApprovalAuthority(null)).toEqual({
			mode: "legacy",
			authority: "legacy",
			shadowMirroring: false,
			compatibilityWriting: false,
		});
		expect(approvalAuthorityOf(undefined)).toBe("legacy");
	});

	it("lists the modes of each authority in rollout order", () => {
		expect(lifecycleModesWithAuthority("legacy")).toEqual(["legacy", "shadow", "ready"]);
		expect(lifecycleModesWithAuthority("canonical")).toEqual(["canonical", "complete"]);
	});

	it.each(["", "LEGACY", "retired", "toString", 42])("refuses the impossible mode %j", (mode) => {
		expect(() => parseApprovalLifecycleMode(mode)).toThrow(/rollout mode is unavailable/);
		expect(() => approvalWriteGateResult(mode as never)).toThrow(/rollout mode is unavailable/);
	});

	it("refuses a gate result without a mode", () => {
		expect(() => approvalWriteGateResult(null as never)).toThrow(/rollout mode is unavailable/);
	});

	it("cannot be changed into another mode's answers", () => {
		const gate = approvalWriteGateResult("shadow");
		expect(() => {
			(gate as { authority: string }).authority = "canonical";
		}).toThrow(TypeError);
		expect(gate.authority).toBe("legacy");
	});
});
