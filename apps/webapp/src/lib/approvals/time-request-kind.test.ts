import { describe, expect, it } from "vitest";
import { classifyTimeApprovalRequest } from "./time-request-kind";

describe("classifyTimeApprovalRequest", () => {
	const clockInCorrectionId = "10000000-0000-4000-8000-000000000001";
	const clockOutCorrectionId = "10000000-0000-4000-8000-000000000002";
	const foreignCorrectionId = "10000000-0000-4000-8000-000000000003";
	const workCategoryId = "20000000-0000-4000-8000-000000000001";
	const editCorrectionMarker = {
		action: "edit",
		workLocationType: "office",
		workCategoryId: null,
	} as const;

	it("leaves correction and ordinary metadata conflicts unclassified", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: editCorrectionMarker,
					timeRequest: { kind: "manual_time_submission" },
				},
				reason: "Manual time entry: missed punch",
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("unclassified");
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("classifies unambiguous explicit %s metadata", (kind) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind } },
			}),
		).toBe(kind);
	});

	it.each([
		{
			kind: "manual_time_submission" as const,
			reason: "Manual time entry: forgot to clock in",
			pendingChanges: { isManualEntry: true },
		},
		{
			kind: "policy_clock_out" as const,
			reason: "Clock-out requires approval (0-day policy)",
			pendingChanges: { isNewClockOut: true },
		},
	])("classifies matching explicit $kind evidence", (input) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind: input.kind } },
				reason: input.reason,
				pendingChanges: input.pendingChanges,
			}),
		).toBe(input.kind);
	});

	it("retains correction classification when no ordinary evidence conflicts", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: {
						...editCorrectionMarker,
						workLocationType: "home",
						workCategoryId,
					},
				},
			}),
		).toBe("time_correction");
	});

	it("classifies historical correction metadata without work metadata", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: { action: "edit", clockInCorrectionId },
				},
				verifiedRelationalCorrectionIds: [clockInCorrectionId],
				verifiedRelationalCorrectionIdsByEndpoint: {
					clockIn: [clockInCorrectionId],
					clockOut: [],
				},
			}),
		).toBe("time_correction");
	});

	it("classifies descriptor snapshots without reading proxy fields", () => {
		let reads = 0;
		const marker = new Proxy(editCorrectionMarker, {
			get() {
				reads += 1;
				throw new Error("hostile marker read");
			},
		});

		expect(
			classifyTimeApprovalRequest({ metadata: { timeCorrection: marker } }),
		).toBe("time_correction");
		expect(reads).toBe(0);

		let accessorReads = 0;
		const accessorMarker = Object.defineProperty(
			{
				workLocationType: "office",
				workCategoryId: null,
			},
			"action",
			{
				enumerable: true,
				get() {
					accessorReads += 1;
					throw new Error("hostile marker accessor");
				},
			},
		);
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeCorrection: accessorMarker },
			}),
		).toBe("unclassified");
		expect(accessorReads).toBe(0);
	});

	it.each(["getPrototypeOf", "getOwnPropertyDescriptor"] as const)(
		"fails closed when outer metadata %s throws",
		(trap) => {
			const metadata = new Proxy(
				{ timeCorrection: editCorrectionMarker },
				trap === "getPrototypeOf"
					? {
							getPrototypeOf() {
								throw new Error("hostile metadata prototype");
							},
						}
					: {
							getOwnPropertyDescriptor() {
								throw new Error("hostile metadata descriptor");
							},
						},
			);

			expect(() => classifyTimeApprovalRequest({ metadata })).not.toThrow();
			expect(classifyTimeApprovalRequest({ metadata })).toBe("unclassified");
		},
	);

	it("classifies explicit correction IDs only with exact verified relational evidence", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: {
						...editCorrectionMarker,
						clockInCorrectionId,
						clockOutCorrectionId,
					},
				},
				verifiedRelationalCorrectionIds: [
					clockInCorrectionId,
					clockOutCorrectionId,
				],
				verifiedRelationalCorrectionIdsByEndpoint: {
					clockIn: [clockInCorrectionId],
					clockOut: [clockOutCorrectionId],
				},
			}),
		).toBe("time_correction");
	});

	it("classifies delete correction metadata only with both endpoint IDs", () => {
		const evidence = {
			verifiedRelationalCorrectionIds: [
				clockInCorrectionId,
				clockOutCorrectionId,
			],
			verifiedRelationalCorrectionIdsByEndpoint: {
				clockIn: [clockInCorrectionId],
				clockOut: [clockOutCorrectionId],
			},
		};
		for (const timeCorrection of [
			{
				...editCorrectionMarker,
				action: "delete" as const,
				clockInCorrectionId,
				clockOutCorrectionId,
			},
			{
				action: "delete" as const,
				clockInCorrectionId,
				clockOutCorrectionId,
			},
		]) {
			expect(
				classifyTimeApprovalRequest({
					metadata: {
						timeCorrection,
					},
					...evidence,
				}),
			).toBe("time_correction");
		}
	});

	it.each([
		{
			name: "swapped endpoints",
			clockInIds: [clockOutCorrectionId],
			clockOutIds: [clockInCorrectionId],
		},
		{
			name: "both corrections replacing clock in",
			clockInIds: [clockInCorrectionId, clockOutCorrectionId],
			clockOutIds: [],
		},
		{
			name: "missing clock-out correction",
			clockInIds: [clockInCorrectionId],
			clockOutIds: [],
		},
		{
			name: "foreign clock-out correction",
			clockInIds: [clockInCorrectionId],
			clockOutIds: [foreignCorrectionId],
		},
	] as const)("rejects explicit correction IDs with $name", (evidence) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: {
						...editCorrectionMarker,
						clockInCorrectionId,
						clockOutCorrectionId,
					},
				},
				verifiedRelationalCorrectionIds: [
					clockInCorrectionId,
					clockOutCorrectionId,
				],
				verifiedRelationalCorrectionIdsByEndpoint: {
					clockIn: evidence.clockInIds,
					clockOut: evidence.clockOutIds,
				},
			}),
		).toBe("unclassified");
	});

	it.each([
		["missing evidence", undefined],
		["orphan evidence", []],
		["foreign evidence", [foreignCorrectionId]],
		["partial evidence", [clockInCorrectionId]],
	] as const)("does not classify explicit correction IDs with %s", (_label, evidence) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: {
							...editCorrectionMarker,
						clockInCorrectionId,
						clockOutCorrectionId,
					},
				},
				verifiedRelationalCorrectionIds: evidence,
			}),
		).toBe("unclassified");
	});

	it.each([
		["non-object metadata", "malformed"],
		["missing correction action", { timeCorrection: {} }],
		[
			"historical edit without endpoint IDs",
			{ timeCorrection: { action: "edit" } },
		],
		[
			"unknown correction action",
			{
				timeCorrection: {
					...editCorrectionMarker,
					action: "merge",
				},
			},
		],
		[
			"missing work location",
			{ timeCorrection: { action: "edit", workCategoryId: null } },
		],
		[
			"missing work category",
			{ timeCorrection: { action: "edit", workLocationType: "office" } },
		],
		[
			"invalid work location",
			{
				timeCorrection: {
					...editCorrectionMarker,
					workLocationType: "field",
				},
			},
		],
		[
			"invalid work category",
			{
				timeCorrection: {
					...editCorrectionMarker,
					workCategoryId: "category-1",
				},
			},
		],
		[
			"delete without endpoint IDs",
			{
				timeCorrection: {
					...editCorrectionMarker,
					action: "delete",
				},
			},
		],
		[
			"delete with one endpoint ID",
			{
				timeCorrection: {
					...editCorrectionMarker,
					action: "delete",
					clockInCorrectionId,
				},
			},
		],
		[
			"extra correction field",
			{
				timeCorrection: {
					...editCorrectionMarker,
					diagnostics: "private",
				},
			},
		],
	] as const)("does not fall back from %s", (_label, metadata) => {
		expect(
			classifyTimeApprovalRequest({
				metadata,
				reason: "Manual time entry: historical fallback",
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("unclassified");
	});

	it.each([
		{
			name: "a manual marker",
			pendingChanges: { isManualEntry: true },
		},
		{
			name: "a clock-out marker",
			pendingChanges: { isNewClockOut: true },
		},
		{
			name: "a manual reason",
			reason: "Manual time entry: forgot to clock in",
		},
		{
			name: "the policy clock-out reason",
			reason: "Clock-out requires approval (0-day policy)",
		},
	] as const)("retains correction precedence over legacy-only $name", (legacy) => {
		expect(
			classifyTimeApprovalRequest({
					metadata: { timeCorrection: editCorrectionMarker },
				reason: "reason" in legacy ? legacy.reason : undefined,
				pendingChanges:
					"pendingChanges" in legacy ? legacy.pendingChanges : undefined,
			}),
		).toBe("time_correction");
	});

	it.each([
		{
			name: "manual metadata with correction metadata",
			input: {
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					timeCorrection: editCorrectionMarker,
				},
			},
		},
		{
			name: "manual metadata with a clock-out marker",
			input: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				pendingChanges: { isNewClockOut: true },
			},
		},
		{
			name: "policy metadata with a manual marker",
			input: {
				metadata: { timeRequest: { kind: "policy_clock_out" } },
				pendingChanges: { isManualEntry: true },
			},
		},
		{
			name: "explicit metadata with dual markers",
			input: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				pendingChanges: { isManualEntry: true, isNewClockOut: true },
			},
		},
		{
			name: "manual metadata with the policy reason",
			input: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				reason: "Clock-out requires approval (0-day policy)",
			},
		},
		{
			name: "policy metadata with a manual reason",
			input: {
				metadata: { timeRequest: { kind: "policy_clock_out" } },
				reason: "Manual time entry: forgot to clock in",
			},
		},
	] as const)("leaves $name unclassified", ({ input }) => {
		expect(classifyTimeApprovalRequest(input)).toBe("unclassified");
	});

	it("classifies a legacy manual request from its reason and marker", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: forgot to clock in",
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("manual_time_submission");
	});

	it("classifies a legacy manual request when old rows have no marker", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: forgot to clock in",
				pendingChanges: null,
			}),
		).toBe("manual_time_submission");
	});

	it("classifies a legacy manual request when pending changes predate kind markers", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: forgot to clock in",
				pendingChanges: { reason: "forgot to clock in", requestedBy: "user-1" },
			}),
		).toBe("manual_time_submission");
	});

	it("prefers a clock-out marker over manual legacy prose", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: ambiguous legacy row",
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("prefers a manual marker over policy clock-out prose", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Clock-out requires approval (0-day policy)",
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("manual_time_submission");
	});

	it("classifies the exact legacy policy clock-out reason", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Clock-out requires approval (0-day policy)",
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("classifies a marker-only manual request when a later chain stage has no reason", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: null,
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("manual_time_submission");
	});

	it("classifies a marker-only policy clock-out even when prose is unavailable", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: null,
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("leaves contradictory marker-only requests unclassified", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: null,
				pendingChanges: { isManualEntry: true, isNewClockOut: true },
			}),
		).toBe("unclassified");
	});

	it("uses relational correction evidence after ordinary legacy signals", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Please fix this shift",
				pendingChanges: null,
				verifiedRelationalCorrectionIds: [clockInCorrectionId],
			}),
		).toBe("time_correction");
	});

	it("leaves requests unclassified when no reliable signal exists", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind: "unknown" } },
				reason: "Please review",
				pendingChanges: { reason: "missing context" },
			}),
		).toBe("unclassified");
	});
});
