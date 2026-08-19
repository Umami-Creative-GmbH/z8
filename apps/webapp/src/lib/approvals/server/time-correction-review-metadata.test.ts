import { describe, expect, it } from "vitest";
import { parseTimeCorrectionReviewMetadata } from "./time-correction-review-metadata";

const clockInCorrectionId = "10000000-0000-4000-8000-000000000001";

describe("parseTimeCorrectionReviewMetadata", () => {
	it.each([null, undefined, {}, { submission: { key: "historical" } }])(
		"treats metadata without an explicit correction marker as absent",
		(metadata) => {
			expect(parseTimeCorrectionReviewMetadata(metadata)).toEqual({
				kind: "legacy_absent",
			});
		},
	);

	it.each([
		["string root", "malformed"],
		[
			"original snapshot without a correction marker",
			{
				timeCorrectionOriginalWorkMetadata: {
					workLocationType: "office",
					workCategoryId: null,
				},
			},
		],
		[
			"unknown action",
			{
				timeCorrection: {
					action: "merge",
					clockInCorrectionId,
				},
			},
		],
		["endpoint-free legacy marker", { timeCorrection: { action: "edit" } }],
		[
			"extra legacy key",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					diagnostics: true,
				},
			},
		],
	] as const)(
		"classifies an explicit malformed %s as malformed",
		(_label, metadata) => {
			expect(parseTimeCorrectionReviewMetadata(metadata)).toEqual({
				kind: "malformed",
			});
		},
	);

	it("recognizes an exact historical v1 marker", () => {
		expect(
			parseTimeCorrectionReviewMetadata({
				timeCorrection: { action: "edit", clockInCorrectionId },
			}),
		).toMatchObject({
			kind: "valid_legacy",
			requested: { action: "edit", clockInCorrectionId },
		});
	});
});
