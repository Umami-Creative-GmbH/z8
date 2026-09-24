import { describe, expect, it } from "vitest";
import { normalizeAbsenceDurationInput } from "@/lib/absences/duration";
import {
	buildAbsenceSubmittedFacts,
	compareLiveAbsenceWithRevision,
	deriveAbsenceSubmittedCoverage,
	fingerprintAbsenceMaterialFacts,
} from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";

function coverageFor(raw: Parameters<typeof normalizeAbsenceDurationInput>[0]) {
	return deriveAbsenceSubmittedCoverage(
		raw,
		normalizeAbsenceDurationInput(raw),
	);
}

function facts(raw: Parameters<typeof normalizeAbsenceDurationInput>[0]) {
	const normalized = normalizeAbsenceDurationInput(raw);
	return buildAbsenceSubmittedFacts({
		organizationId: "org-1",
		absenceId: "absence-1",
		subjectEmployeeId: "employee-1",
		requesterEmployeeId: "employee-1",
		categoryId: "category-1",
		raw,
		normalized,
		entry: {
			startDate: normalized.startDate,
			startPeriod: normalized.startPeriod,
			endDate: normalized.endDate,
			endPeriod: normalized.endPeriod,
		},
		canonicalRecord: {
			id: "record-1",
			startAt: new Date("2026-05-11T00:00:00.000Z"),
			endAt: new Date("2026-05-12T23:59:59.999Z"),
		},
	});
}

const labels = {
	subjectName: "Avery",
	requesterName: "Avery",
	submitterName: "Avery",
	categoryName: "Vacation",
};

describe("absence submitted coverage", () => {
	it("keeps full-day ranges as logical inclusive dates", () => {
		expect(
			coverageFor({
				categoryId: "category-1",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
				durationKind: "full_day",
			}),
		).toEqual({
			coverage: {
				kind: "full_day",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
			},
			inputEncoding: "duration_kind_full_day",
		});
		expect(
			coverageFor({ categoryId: "category-1", startDate: "2026-05-11" })
				.inputEncoding,
		).toBe("period_defaults_full_day");
	});

	it("distinguishes genuine half-day periods", () => {
		expect(
			coverageFor({
				categoryId: "category-1",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
				startPeriod: "pm",
				endPeriod: "am",
			}),
		).toEqual({
			coverage: {
				kind: "half_day_periods",
				startDate: "2026-05-11",
				startPeriod: "pm",
				endDate: "2026-05-12",
				endPeriod: "am",
			},
			inputEncoding: "legacy_period_only",
		});
	});

	it("retains explicit partial times that the entry encoding reduces to AM/AM", () => {
		const raw = {
			categoryId: "category-1",
			startDate: "2026-05-11",
			endDate: "2026-05-11",
			durationKind: "partial_day" as const,
			startTime: "09:00",
			endTime: "12:30",
		};
		const normalized = normalizeAbsenceDurationInput(raw);
		// The compatibility shape alone is indistinguishable from a morning request.
		expect([normalized.startPeriod, normalized.endPeriod]).toEqual([
			"am",
			"am",
		]);
		expect(deriveAbsenceSubmittedCoverage(raw, normalized).coverage).toEqual({
			kind: "explicit_partial",
			startDate: "2026-05-11",
			startTime: "09:00",
			endDate: "2026-05-11",
			endTime: "12:30",
			overnight: false,
			wallClockZone: "not_captured",
		});
	});

	it("marks overnight explicit partial coverage", () => {
		expect(
			coverageFor({
				categoryId: "category-1",
				startDate: "2026-05-11",
				endDate: "2026-05-12",
				durationKind: "partial_day",
				startTime: "22:00",
				endTime: "02:00",
			}).coverage,
		).toMatchObject({ kind: "explicit_partial", overnight: true });
	});

	it("refuses to guess unclassifiable coverage", () => {
		expect(() =>
			deriveAbsenceSubmittedCoverage(
				{ startDate: "2026-05-11", durationKind: "partial_day" },
				{
					startDate: "2026-05-11",
					endDate: "2026-05-11",
					durationKind: "partial_day",
					startPeriod: "am",
					endPeriod: "am",
				},
			),
		).toThrow(ApprovalEvidenceError);
	});
});

describe("absence material revision", () => {
	it("fingerprints material facts without labels or compatibility encodings", () => {
		const first = facts({
			categoryId: "category-1",
			startDate: "2026-05-11",
			endDate: "2026-05-12",
		});
		const reencoded = {
			...first,
			compatibility: {
				...first.compatibility,
				canonicalRecord: {
					...first.compatibility.canonicalRecord,
					id: "record-2",
				},
			},
		};
		expect(fingerprintAbsenceMaterialFacts(reencoded)).toBe(
			fingerprintAbsenceMaterialFacts(first),
		);
		expect(
			fingerprintAbsenceMaterialFacts({
				...first,
				coverage: {
					kind: "full_day",
					startDate: "2026-05-11",
					endDate: "2026-05-13",
				},
			}),
		).not.toBe(fingerprintAbsenceMaterialFacts(first));
	});

	const submitted = facts({
		categoryId: "category-1",
		startDate: "2026-05-11",
		endDate: "2026-05-12",
	});
	const live = {
		organizationId: "org-1",
		absenceId: "absence-1",
		employeeId: "employee-1",
		categoryId: "category-1",
		startDate: "2026-05-11",
		startPeriod: "full_day" as const,
		endDate: "2026-05-12",
		endPeriod: "full_day" as const,
		categoryName: "Vacation",
	};

	it("treats a renamed category as a label-only change", () => {
		expect(
			compareLiveAbsenceWithRevision(submitted, labels, {
				...live,
				categoryName: "Annual leave",
			}),
		).toEqual({
			kind: "current",
			labelChanges: [
				{
					field: "categoryName",
					submitted: "Vacation",
					current: "Annual leave",
				},
			],
		});
	});

	it("treats changed dates or category identity as material", () => {
		expect(
			compareLiveAbsenceWithRevision(submitted, labels, {
				...live,
				endDate: "2026-05-11",
				categoryId: "category-2",
			}),
		).toEqual({
			kind: "material_change",
			changedFields: ["categoryId", "endDate"],
		});
	});
});
