import { inspect } from "node:util";
import { Cause, Exit } from "effect";
import { makeDynamicHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, ConflictError, DatabaseError, ValidationError } from "./errors";
import { STATUTORY_PUBLICATION_BLOCKED } from "@/lib/statutory/scheduling/publication-block";
import { StatutoryPublicationBlockedError } from "@/lib/statutory/scheduling/publication-blocked-error";
import { toServerActionResult } from "./result";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("toServerActionResult", () => {
	it("rethrows Next prerender cancellation before logging or returning a server-action error", async () => {
		const controller = new AbortController();
		const rejected = makeDynamicHangingPromise(
			controller.signal,
			"/fixture",
			"`connection()`",
		).catch((error: unknown) => error);
		controller.abort();
		const cancellation = await rejected;
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => toServerActionResult(Exit.die(cancellation))).toThrow(cancellation);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("retains ordinary authentication failures as refused server-action results", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		expect(
			toServerActionResult(Exit.fail(new AuthenticationError({ message: "Not authenticated" }))),
		).toEqual({
			success: false,
			error: "Not authenticated",
			code: "AuthenticationError",
		});
	});

	it("returns the success value", () => {
		expect(toServerActionResult(Exit.succeed({ id: "entry-1" }))).toEqual({
			success: true,
			data: { id: "entry-1" },
		});
	});

	it("logs payroll conflict diagnostics without exposing them to the client", () => {
		const error = new ConflictError({
			message: "Payroll data is temporarily unavailable",
			conflictType: "canonical_payroll_data_not_ready",
			details: {
				organizationId: "org-1",
				reconciliation: {
					workCountMismatch: 2,
					absenceCountMismatch: 1,
					durationMismatchRecords: 3,
				},
			},
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(Exit.fail(error));

		expect(consoleError).toHaveBeenCalledWith("[ServerAction Error]", error);
		expect(result).toEqual({
			success: false,
			error: "Payroll data is temporarily unavailable",
			code: "ConflictError",
		});
		expect(result).not.toHaveProperty("details");
	});

	it.each([
		[
			"a refusal listing the viewer's findings",
			() =>
				new ValidationError({
					message: "Cannot publish",
					field: "shifts",
					refusal: STATUTORY_PUBLICATION_BLOCKED,
					value: {
						statutoryFindings: {
							items: [{ employeeName: "Anna Berg", finding: { employeeId: "employee-anna" } }],
							outsideScopeCount: 0,
							canOpenReviews: false,
						},
					},
				}),
		],
		[
			"the publication's own publish-block refusal",
			() =>
				new StatutoryPublicationBlockedError({
					message: "Cannot publish",
					blockingFindings: [
						{
							type: "statutory",
							employeeId: "employee-anna",
							findingId: "jarbschg_daily_max:employee-anna:shift:s1",
							statutoryKind: "jarbschg_daily_max",
							domain: "youth_protection",
							severity: "critical",
							subjectKey: "shift:s1",
							legalReference: "§ 8 Abs. 1 JArbSchG",
							summary: { tier: "exceeded" },
							day: "2027-03-02",
							acknowledgementStatus: null,
							blocksPublication: true,
						},
					],
				}),
		],
	])("logs %s by its tag, refusal and message only, never the findings it carries", (_, make) => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

		toServerActionResult(Exit.fail(make()));

		const logged = [...consoleError.mock.calls, ...consoleWarn.mock.calls]
			.flat()
			.map((arg) => inspect(arg, { depth: null, showHidden: true }))
			.join("\n");
		expect(logged).toContain(STATUTORY_PUBLICATION_BLOCKED);
		expect(logged).toContain("Cannot publish");
		expect(logged).not.toMatch(/Anna Berg|employee-anna|jarbschg_daily_max|statutoryFindings/);
	});

	it("passes a validation value through as the holiday name", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(
			Exit.fail(
				new ValidationError({ message: "Date is a holiday", field: "date", value: "New Year" }),
			),
		);

		expect(result).toEqual({
			success: false,
			error: "Date is a holiday",
			code: "ValidationError",
			holidayName: "New Year",
		});
	});

	it("refuses a statutory publish block without its unscoped blocking findings", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new StatutoryPublicationBlockedError({
			message: "Cannot publish",
			blockingFindings: [
				{
					type: "statutory",
					employeeId: "employee-outside-scope",
					findingId: "jarbschg_daily_max:employee-outside-scope:shift:s1",
					statutoryKind: "jarbschg_daily_max",
					domain: "youth_protection",
					severity: "critical",
					subjectKey: "shift:s1",
					legalReference: "§ 8 Abs. 1 JArbSchG",
					summary: { tier: "exceeded" },
					day: "2027-03-02",
					acknowledgementStatus: null,
					blocksPublication: true,
				},
			],
		});

		const result = toServerActionResult(Exit.fail(error));

		expect(result).toEqual({
			success: false,
			error: "Cannot publish",
			code: "ValidationError",
			refusal: STATUTORY_PUBLICATION_BLOCKED,
		});
		expect(JSON.stringify(result)).not.toContain("employee-outside-scope");
	});

	it("reports the typed failure, not a finalizer defect, when the cause holds both", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new ValidationError({ message: "End must be after start", field: "end" });

		const result = toServerActionResult(
			Exit.failCause(Cause.combine(Cause.die(new Error("finalizer blew up")), Cause.fail(error))),
		);

		expect(result).toEqual({
			success: false,
			error: "End must be after start",
			code: "ValidationError",
		});
	});

	it("reports an interrupt-only cause with the generic message, not the internal one", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(Exit.failCause(Cause.interrupt()));

		expect(result).toEqual({
			success: false,
			error: "An unexpected error occurred",
			code: "UNKNOWN_ERROR",
		});
	});

	it("reports a defect as an unknown error with its message", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = toServerActionResult(Exit.die(new Error("connection reset")));

		expect(result).toEqual({
			success: false,
			error: "connection reset",
			code: "UNKNOWN_ERROR",
		});
	});

	it("reports the database's closed-month refusal as the typed month-closed refusal", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const refusal = Object.assign(new Error("month closed"), { code: "Z8M01", detail: "2026-03" });
		const wrapped = new DatabaseError({
			message: "Database query failed: absences.request",
			operation: "absences.request",
			cause: Object.assign(new Error("Failed query"), { cause: refusal }),
		});

		const result = toServerActionResult(Exit.fail(wrapped));

		expect(result).toEqual({
			success: false,
			error: "March 2026 is closed. It must be reopened before its work or absences can change.",
			code: "MonthClosedError",
			closedMonth: "2026-03",
		});
	});
});
