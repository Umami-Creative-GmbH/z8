import { describe, expect, it, vi } from "vitest";
import {
	ORDINARY_WORK_PERIOD_APPROVAL_KINDS,
	parseOrdinaryWorkPeriodWorkflowPayload,
} from "./work-period-contract";

describe("ordinary work-period workflow contract", () => {
	it.each(
		ORDINARY_WORK_PERIOD_APPROVAL_KINDS,
	)("parses a canonical %s payload with exact enumerable data properties", (kind) => {
		const parsed = parseOrdinaryWorkPeriodWorkflowPayload({
			timeRequest: { kind },
		});

		expect(parsed).toEqual({ timeRequest: { kind } });
		expect(Reflect.ownKeys(parsed)).toEqual(["timeRequest"]);
		expect(Reflect.ownKeys(parsed.timeRequest)).toEqual(["kind"]);
		expect(
			Object.getOwnPropertyDescriptor(parsed, "timeRequest"),
		).toMatchObject({
			enumerable: true,
			value: parsed.timeRequest,
		});
		expect(
			Object.getOwnPropertyDescriptor(parsed.timeRequest, "kind"),
		).toMatchObject({ enumerable: true, value: kind });
		expect(JSON.stringify(parsed)).toBe(`{"timeRequest":{"kind":"${kind}"}}`);
	});

	it("keeps canonical payload evidence independent of ordinary source UUIDs", () => {
		const first = {
			id: "10000000-0000-4000-8000-000000000001",
			payload: parseOrdinaryWorkPeriodWorkflowPayload({
				timeRequest: { kind: "manual_time_submission" },
			}),
		};
		const second = {
			id: "20000000-0000-4000-8000-000000000002",
			payload: parseOrdinaryWorkPeriodWorkflowPayload({
				timeRequest: { kind: "manual_time_submission" },
			}),
		};

		expect(first.id).not.toBe(second.id);
		expect(JSON.stringify(first.payload)).toBe(JSON.stringify(second.payload));
	});

	it.each([
		["a primitive", null],
		["a root array", [{ timeRequest: { kind: "manual_time_submission" } }]],
		["a nested array", { timeRequest: ["manual_time_submission"] }],
		["an empty root", {}],
		["an empty request", { timeRequest: {} }],
		["an unknown kind", { timeRequest: { kind: "time_correction" } }],
		[
			"an unknown root key",
			{
				timeRequest: { kind: "manual_time_submission" },
				sourceId: "10000000-0000-4000-8000-000000000001",
			},
		],
		[
			"an unknown request key",
			{
				timeRequest: {
					kind: "manual_time_submission",
					sourceId: "10000000-0000-4000-8000-000000000001",
				},
			},
		],
	] as const)("rejects %s", (_name, value) => {
		expect(() => parseOrdinaryWorkPeriodWorkflowPayload(value)).toThrow(Error);
	});

	it.each([
		"root",
		"nested",
	] as const)("rejects a custom or null prototype at the %s level", (level) => {
		for (const prototype of [null, { inherited: true }]) {
			const unusual = Object.assign(
				Object.create(prototype),
				level === "root"
					? { timeRequest: { kind: "manual_time_submission" } }
					: { kind: "manual_time_submission" },
			);
			const value = level === "root" ? unusual : { timeRequest: unusual };

			expect(() => parseOrdinaryWorkPeriodWorkflowPayload(value)).toThrow(
				Error,
			);
		}
	});

	it.each([
		"root",
		"nested",
	] as const)("rejects non-enumerable and symbol properties at the %s level", (level) => {
		for (const property of ["hidden", Symbol("hidden")]) {
			const target =
				level === "root"
					? { timeRequest: { kind: "manual_time_submission" } }
					: { kind: "manual_time_submission" };
			Object.defineProperty(target, property, {
				enumerable: false,
				value: "private",
			});
			const value = level === "root" ? target : { timeRequest: target };

			expect(() => parseOrdinaryWorkPeriodWorkflowPayload(value)).toThrow(
				Error,
			);
		}
	});

	it.each([
		"root",
		"nested",
	] as const)("rejects accessors at the %s level without invoking them", (level) => {
		let accesses = 0;
		const target = Object.defineProperty(
			{},
			level === "root" ? "timeRequest" : "kind",
			{
				enumerable: true,
				get() {
					accesses += 1;
					return level === "root"
						? { kind: "manual_time_submission" }
						: "manual_time_submission";
				},
			},
		);
		const value = level === "root" ? target : { timeRequest: target };

		expect(() => parseOrdinaryWorkPeriodWorkflowPayload(value)).toThrow(Error);
		expect(accesses).toBe(0);
	});

	it("rejects a fixed-kind mismatch without serializing attacker evidence", () => {
		const serialize = vi.spyOn(JSON, "stringify");
		const payload = { timeRequest: { kind: "policy_clock_out" } };

		try {
			parseOrdinaryWorkPeriodWorkflowPayload(payload, "manual_time_submission");
			expect.unreachable("mismatched payload should be rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(String(error)).not.toContain("policy_clock_out");
		}
		expect(serialize).not.toHaveBeenCalled();
		serialize.mockRestore();
	});

	it("returns newly allocated recursively frozen evidence", () => {
		const input = {
			timeRequest: { kind: "manual_time_submission" as const },
		};

		const parsed = parseOrdinaryWorkPeriodWorkflowPayload(input);

		expect(parsed).not.toBe(input);
		expect(parsed.timeRequest).not.toBe(input.timeRequest);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.timeRequest)).toBe(true);
		input.timeRequest.kind = "policy_clock_out" as never;
		expect(parsed.timeRequest.kind).toBe("manual_time_submission");
	});
});
