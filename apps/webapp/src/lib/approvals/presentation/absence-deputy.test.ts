import { describe, expect, it } from "vitest";
import { buildAbsenceDeputySection } from "./absence-deputy";

describe("buildAbsenceDeputySection", () => {
	it("names the deputy who covers during the absence", () => {
		expect(
			buildAbsenceDeputySection({ id: "ben", name: "Ben Example", canDecideApprovals: true }),
		).toEqual({
			type: "key_value",
			title: { key: "approvals:approvals.deputy.title", fallback: "Cover" },
			rows: [
				{
					label: { key: "approvals:approvals.deputy.label", fallback: "Deputy" },
					value: "Ben Example",
				},
			],
		});
	});

	it("notes when the deputy is a contact only", () => {
		expect(
			buildAbsenceDeputySection({ id: "ben", name: "Ben Example", canDecideApprovals: false }).rows,
		).toEqual([
			{
				label: { key: "approvals:approvals.deputy.label", fallback: "Deputy" },
				value: "Ben Example",
			},
			{
				label: { key: "approvals:approvals.deputy.approvals", fallback: "Approvals" },
				value: {
					key: "approvals:approvals.deputy.contactOnly",
					fallback: "Contact only: cannot decide approvals",
				},
				tone: "warning",
			},
		]);
	});

	it("says when no deputy is named", () => {
		expect(buildAbsenceDeputySection(null).rows).toEqual([
			{
				label: { key: "approvals:approvals.deputy.label", fallback: "Deputy" },
				value: { key: "approvals:approvals.deputy.none", fallback: "None named" },
			},
		]);
	});
});
