import { describe, expect, it } from "vitest";
import { parseProjectAttributionExceptionDraft } from "../project-attribution-exception";

const draft = {
	employeeId: "employee-1",
	projectId: "project-1",
	validFrom: "2026-03-01",
	validTo: "2026-06-30",
	reason: "  Staffed on the project before assignments were recorded ",
	evidence: "Staffing plan Q2, approved by the project lead",
};

describe("parseProjectAttributionExceptionDraft", () => {
	it("accepts a past date range with a reason and evidence, trimmed", () => {
		expect(parseProjectAttributionExceptionDraft(draft, "2026-10-06")).toEqual({
			ok: true,
			draft: { ...draft, reason: "Staffed on the project before assignments were recorded" },
		});
	});

	it("requires an explanation and the evidence it rests on", () => {
		expect(
			parseProjectAttributionExceptionDraft({ ...draft, reason: " ", evidence: "" }, "2026-10-06"),
		).toEqual({ ok: false, errors: ["reason", "evidence"] });
	});

	it("refuses malformed, reversed and future date ranges", () => {
		expect(
			parseProjectAttributionExceptionDraft({ ...draft, validFrom: "2026-02-30" }, "2026-10-06"),
		).toEqual({ ok: false, errors: ["valid_from"] });
		expect(
			parseProjectAttributionExceptionDraft(
				{ ...draft, validFrom: "2026-07-01", validTo: "2026-06-30" },
				"2026-10-06",
			),
		).toEqual({ ok: false, errors: ["date_order"] });
		expect(
			parseProjectAttributionExceptionDraft({ ...draft, validTo: "2026-10-07" }, "2026-10-06"),
		).toEqual({ ok: false, errors: ["future_dates"] });
	});

	it("covers only dates before captured assignment history (#605 review)", () => {
		expect(parseProjectAttributionExceptionDraft(draft, "2026-10-06", "2026-07-01")).toMatchObject({
			ok: true,
		});
		expect(parseProjectAttributionExceptionDraft(draft, "2026-10-06", "2026-06-30")).toEqual({
			ok: false,
			errors: ["after_history_capture"],
		});
		expect(parseProjectAttributionExceptionDraft(draft, "2026-10-06", "2026-04-01")).toEqual({
			ok: false,
			errors: ["after_history_capture"],
		});
	});
});
