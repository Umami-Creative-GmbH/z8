import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { deriveTimeCorrectionRowId } from "../workflow/identity";
import {
	deriveTimeCorrectionSubmissionKey,
	normalizeTimeCorrectionWorkflowPayload,
	type TimeCorrectionSubmissionIdentityInput,
} from "./time-correction-contract";

const clockInCorrectionId = "10000000-0000-4000-8000-000000000011";
const clockOutCorrectionId = "10000000-0000-4000-8000-000000000012";
const clockInOriginalId = "20000000-0000-4000-8000-000000000011";
const clockOutOriginalId = "20000000-0000-4000-8000-000000000012";
const workPeriodId = "30000000-0000-4000-8000-000000000001";
const clockInInstant = parseInstant("2026-07-20T06:00:00+02:00");
const clockOutInstant = parseInstant("2026-07-20T15:00:00-04:00");

describe("time correction workflow contract", () => {
	it("normalizes a detached immutable edit payload in canonical endpoint order", () => {
		const input = {
			timeCorrection: {
				clockOutCorrectionId,
				action: "edit",
				clockInCorrectionId,
			},
		};

		const normalized = normalizeTimeCorrectionWorkflowPayload(input);

		expect(normalized).toEqual({
			timeCorrection: {
				action: "edit",
				clockInCorrectionId,
				clockOutCorrectionId,
			},
		});
		expect(Object.keys(normalized.timeCorrection)).toEqual([
			"action",
			"clockInCorrectionId",
			"clockOutCorrectionId",
		]);
		expect(normalized).not.toBe(input);
		expect(normalized.timeCorrection).not.toBe(input.timeCorrection);
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized.timeCorrection)).toBe(true);
		input.timeCorrection.clockInCorrectionId = clockOutCorrectionId;
		expect(normalized.timeCorrection.clockInCorrectionId).toBe(
			clockInCorrectionId,
		);
	});

	it("snapshots stateful payload proxy fields once before validation", () => {
		const reads = {
			action: 0,
			clockInCorrectionId: 0,
		};
		const correction = new Proxy(
			{ action: "edit", clockInCorrectionId },
			{
				get(target, property, receiver) {
					if (property === "action") {
						reads.action += 1;
						return reads.action < 3 ? "edit" : "delete";
					}
					if (property === "clockInCorrectionId") {
						reads.clockInCorrectionId += 1;
					}
					return Reflect.get(target, property, receiver);
				},
			},
		);

		const normalized = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: correction,
		});

		expect(normalized).toEqual({
			timeCorrection: { action: "edit", clockInCorrectionId },
		});
		expect(reads.action).toBeLessThanOrEqual(1);
		expect(reads.clockInCorrectionId).toBeLessThanOrEqual(1);
	});

	it("requires both distinct correction IDs for delete", () => {
		expect(
			normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: {
					action: "delete",
					clockInCorrectionId,
					clockOutCorrectionId,
				},
			}),
		).toEqual({
			timeCorrection: {
				action: "delete",
				clockInCorrectionId,
				clockOutCorrectionId,
			},
		});

		for (const value of [
			{
				timeCorrection: {
					action: "delete",
					clockInCorrectionId,
				},
			},
			{
				timeCorrection: {
					action: "delete",
					clockOutCorrectionId,
				},
			},
			{
				timeCorrection: {
					action: "delete",
					clockInCorrectionId,
					clockOutCorrectionId: clockInCorrectionId,
				},
			},
		]) {
			expect(() => normalizeTimeCorrectionWorkflowPayload(value)).toThrowError(
				"Time correction workflow payload is invalid",
			);
		}
	});

	it.each([
		["an empty payload", {}],
		["an empty correction", { timeCorrection: {} }],
		["an edit without endpoints", { timeCorrection: { action: "edit" } }],
		[
			"an invalid action",
			{ timeCorrection: { action: "replace", clockInCorrectionId } },
		],
		[
			"a blank ID",
			{ timeCorrection: { action: "edit", clockInCorrectionId: "  " } },
		],
		[
			"a malformed UUID",
			{ timeCorrection: { action: "edit", clockInCorrectionId: "entry-1" } },
		],
		[
			"a malformed nested type",
			{ timeCorrection: { action: "edit", clockInCorrectionId: 42 } },
		],
		["a malformed root type", []],
		[
			"an unknown root key",
			{
				timeCorrection: { action: "edit", clockInCorrectionId },
				privateNote: "do not accept",
			},
		],
		[
			"an unknown correction key",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					note: "do not accept",
				},
			},
		],
	] as const)("rejects %s without exposing input evidence", (_name, value) => {
		try {
			normalizeTimeCorrectionWorkflowPayload(value);
			expect.unreachable("payload should be rejected");
		} catch (error) {
			expect(error).toMatchObject({
				name: "TimeCorrectionWorkflowPayloadError",
				message: "Time correction workflow payload is invalid",
			});
			expect(String(error)).not.toContain(clockInCorrectionId);
			expect(String(error)).not.toContain("do not accept");
		}
	});

	it("rejects non-JSON object shapes without invoking accessors", () => {
		const hidden = {
			timeCorrection: { action: "edit", clockInCorrectionId },
		};
		Object.defineProperty(hidden, "privateNote", {
			enumerable: false,
			value: "hidden private evidence",
		});
		let accesses = 0;
		const accessor = Object.defineProperty({}, "timeCorrection", {
			enumerable: true,
			get() {
				accesses += 1;
				return { action: "edit", clockInCorrectionId };
			},
		});

		expect(() => normalizeTimeCorrectionWorkflowPayload(hidden)).toThrowError(
			"Time correction workflow payload is invalid",
		);
		expect(() => normalizeTimeCorrectionWorkflowPayload(accessor)).toThrowError(
			"Time correction workflow payload is invalid",
		);
		expect(accesses).toBe(0);
	});

	it("wraps hostile object failures without exposing correction evidence", () => {
		const secret = "10000000-0000-4000-8000-000000000099";
		const hostile = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error(`driver exposed ${secret}`);
				},
			},
		);

		try {
			normalizeTimeCorrectionWorkflowPayload(hostile);
			expect.unreachable("payload should be rejected");
		} catch (error) {
			expect(error).toMatchObject({
				name: "TimeCorrectionWorkflowPayloadError",
				message: "Time correction workflow payload is invalid",
			});
			expect(error).not.toHaveProperty("cause");
			expect(String(error)).not.toContain(secret);
		}
	});

	it("derives a stable organization-scoped submission key from business evidence", () => {
		const input = {
			organizationId: " org-1 ",
			workPeriodId: ` ${workPeriodId} `,
			action: "edit" as const,
			clockIn: {
				instant: clockInInstant,
				originalEntryId: ` ${clockInOriginalId} `,
			},
			clockOut: {
				originalEntryId: clockOutOriginalId,
				instant: clockOutInstant,
			},
		};

		const key = deriveTimeCorrectionSubmissionKey(input);

		expect(key).toBe(
			"time-correction-submission:v1:4d54201a3a6ad7fb6a85276e534dca3c0b179a3b365a63b38230b364335d013b",
		);
		expect(
			deriveTimeCorrectionSubmissionKey({
				clockOut: { ...input.clockOut },
				action: input.action,
				workPeriodId,
				clockIn: { ...input.clockIn, originalEntryId: clockInOriginalId },
				organizationId: "org-1",
			}),
		).toBe(key);

		const variants = [
			deriveTimeCorrectionSubmissionKey({ ...input, organizationId: "org-2" }),
			deriveTimeCorrectionSubmissionKey({
				...input,
				workPeriodId: "30000000-0000-4000-8000-000000000002",
			}),
			deriveTimeCorrectionSubmissionKey({ ...input, action: "delete" }),
			deriveTimeCorrectionSubmissionKey({
				...input,
				clockIn: {
					...input.clockIn,
					originalEntryId: "20000000-0000-4000-8000-000000000099",
				},
			}),
			deriveTimeCorrectionSubmissionKey({
				...input,
				clockOut: {
					...input.clockOut,
					instant: parseInstant("2026-07-20T19:00:01Z"),
				},
			}),
		];
		expect(new Set([key, ...variants])).toHaveLength(variants.length + 1);
	});

	it("keeps random correction row IDs out of submission identity", () => {
		const identity: TimeCorrectionSubmissionIdentityInput = {
			organizationId: "org-1",
			workPeriodId,
			action: "edit",
			clockIn: { originalEntryId: clockInOriginalId, instant: clockInInstant },
		};
		const firstSubmission = {
			payload: normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
				},
			}),
			identity,
		};
		const retriedSubmission = {
			payload: normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000099",
				},
			}),
			identity: { ...identity },
		};

		expect(retriedSubmission.payload).not.toEqual(firstSubmission.payload);
		expect(deriveTimeCorrectionSubmissionKey(retriedSubmission.identity)).toBe(
			deriveTimeCorrectionSubmissionKey(firstSubmission.identity),
		);
	});

	it.each([
		"top-level",
		"endpoint",
	] as const)("wraps hostile %s identity getters without exposing evidence", (boundary) => {
		const secret = `private-${boundary}-correction-evidence`;
		const endpoint = {
			originalEntryId: clockInOriginalId,
			instant: clockInInstant,
		};
		const input = {
			organizationId: "org-1",
			workPeriodId,
			action: "edit" as const,
			clockIn:
				boundary === "endpoint"
					? new Proxy(endpoint, {
							get(target, property, receiver) {
								if (property === "originalEntryId") {
									throw new Error(secret);
								}
								return Reflect.get(target, property, receiver);
							},
						})
					: endpoint,
		};
		const hostile =
			boundary === "top-level"
				? new Proxy(input, {
						get(target, property, receiver) {
							if (property === "organizationId") {
								throw new Error(secret);
							}
							return Reflect.get(target, property, receiver);
						},
					})
				: input;

		try {
			deriveTimeCorrectionSubmissionKey(hostile);
			expect.unreachable("identity should be rejected");
		} catch (error) {
			expect(error).toMatchObject({
				name: "TimeCorrectionContractError",
				message: "Time correction contract is invalid",
			});
			expect(error).not.toHaveProperty("cause");
			expect(String(error)).not.toContain(secret);
		}
	});

	it("ignores hostile own Instant serialization methods", () => {
		let calls = 0;
		const hostileInstant = parseInstant("2026-07-20T04:00:00Z");
		Object.defineProperty(hostileInstant, "toString", {
			value() {
				calls += 1;
				throw new Error("private-instant-correction-evidence");
			},
		});

		const key = deriveTimeCorrectionSubmissionKey({
			organizationId: "org-1",
			workPeriodId,
			action: "edit",
			clockIn: {
				originalEntryId: clockInOriginalId,
				instant: hostileInstant,
			},
		});

		expect(key).toBe(
			deriveTimeCorrectionSubmissionKey({
				organizationId: "org-1",
				workPeriodId,
				action: "edit",
				clockIn: {
					originalEntryId: clockInOriginalId,
					instant: parseInstant("2026-07-20T04:00:00Z"),
				},
			}),
		);
		expect(calls).toBe(0);
	});

	it("distinguishes genuine Instants despite identical own serialization overrides", () => {
		const first = parseInstant("2026-07-20T04:00:00Z");
		const second = parseInstant("2026-07-20T05:00:00Z");
		for (const instant of [first, second]) {
			Object.defineProperty(instant, "toString", {
				value: () => "same-hostile-value",
			});
		}
		const identity = {
			organizationId: "org-1",
			workPeriodId,
			action: "edit" as const,
			clockIn: { originalEntryId: clockInOriginalId, instant: first },
		};

		expect(deriveTimeCorrectionSubmissionKey(identity)).not.toBe(
			deriveTimeCorrectionSubmissionKey({
				...identity,
				clockIn: { ...identity.clockIn, instant: second },
			}),
		);
	});

	it("rejects malformed submission identity without reflecting private values", () => {
		for (const input of [
			{
				organizationId: " ",
				workPeriodId,
				action: "edit",
				clockIn: {
					originalEntryId: clockInOriginalId,
					instant: clockInInstant,
				},
			},
			{
				organizationId: "org-1",
				workPeriodId,
				action: "edit",
			},
			{
				organizationId: "org-1",
				workPeriodId,
				action: "delete",
				clockIn: {
					originalEntryId: clockInOriginalId,
					instant: clockInInstant,
				},
			},
			{
				organizationId: "org-1",
				workPeriodId,
				action: "edit",
				clockIn: {
					originalEntryId: "secret-invalid-id",
					instant: "not-an-instant",
				},
			},
		] as const) {
			try {
				deriveTimeCorrectionSubmissionKey(input as never);
				expect.unreachable("identity should be rejected");
			} catch (error) {
				expect(error).toMatchObject({
					name: "TimeCorrectionContractError",
					message: "Time correction contract is invalid",
				});
				expect(String(error)).not.toContain("secret-invalid-id");
			}
		}
	});

	it("derives stable endpoint-specific correction row UUIDs", () => {
		const submissionKey = deriveTimeCorrectionSubmissionKey({
			organizationId: "org-1",
			workPeriodId,
			action: "edit",
			clockIn: { originalEntryId: clockInOriginalId, instant: clockInInstant },
			clockOut: {
				originalEntryId: clockOutOriginalId,
				instant: clockOutInstant,
			},
		});
		const clockInId = deriveTimeCorrectionRowId({
			submissionKey,
			endpointType: "clock_in",
		});
		const clockOutId = deriveTimeCorrectionRowId({
			endpointType: "clock_out",
			submissionKey,
		});

		expect(clockInId).toBe("c250cb5b-3fee-50f4-b3a9-cb6c19d46fa3");
		expect(clockOutId).toBe("32224f7a-5e56-5573-8b9d-a0d5064142c1");
		expect(clockOutId).not.toBe(clockInId);
		expect(
			deriveTimeCorrectionRowId({
				submissionKey,
				endpointType: "clock_in",
			}),
		).toBe(clockInId);
	});
});
