import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	confirmedTermsSpans,
	type TermsDatesRow,
	termsCalendarDate,
	termsInForceDuring,
	termsInForceOn,
} from "./terms-in-force";

type Row = TermsDatesRow & { id: string };

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);
const date = parsePlainDate;

function row(
	id: string,
	validFrom: Date,
	validUntil: Date | null,
	reviewState: Row["reviewState"] = "confirmed",
): Row {
	return { id, validFrom, validUntil, reviewState };
}

describe("termsCalendarDate", () => {
	it("reads a UTC-midnight timestamp as that calendar date in every timezone", () => {
		expect(termsCalendarDate(utcMidnight("2026-03-10"), "America/New_York").toString()).toBe(
			"2026-03-10",
		);
		expect(termsCalendarDate(utcMidnight("2026-03-10"), "Asia/Tokyo").toString()).toBe(
			"2026-03-10",
		);
	});

	it("reads any other timestamp as its org-local calendar date", () => {
		// A departure cutoff: Berlin midnight starting 15 March.
		expect(
			termsCalendarDate(new Date("2026-03-14T23:00:00.000Z"), "Europe/Berlin").toString(),
		).toBe("2026-03-15");
		// A rehire at 02:00 UTC is still the previous evening in New York.
		expect(
			termsCalendarDate(new Date("2026-03-15T02:00:00.000Z"), "America/New_York").toString(),
		).toBe("2026-03-14");
	});
});

describe("terms in force", () => {
	const earlier = row("earlier", utcMidnight("2026-03-01"), utcMidnight("2026-03-15"));
	const later = row("later", utcMidnight("2026-03-15"), null);

	it("gives a boundary day to exactly one set of terms", () => {
		const rows = [earlier, later];

		expect(termsInForceOn(rows, date("2026-03-14"), "America/New_York")?.id).toBe("earlier");
		expect(termsInForceOn(rows, date("2026-03-15"), "America/New_York")?.id).toBe("later");
		expect(
			termsInForceDuring(
				rows,
				{ from: date("2026-03-01"), toExclusive: date("2026-04-01") },
				"America/New_York",
			).map((span) => [span.terms.id, span.from.toString(), span.until?.toString()]),
		).toEqual([
			["earlier", "2026-03-01", "2026-03-15"],
			["later", "2026-03-15", "2026-04-01"],
		]);
	});

	it("ignores draft and pending terms", () => {
		const rows = [
			earlier,
			row("draft", utcMidnight("2026-03-10"), null, "draft"),
			row("pending", utcMidnight("2026-03-12"), null, "pending"),
		];

		expect(termsInForceOn(rows, date("2026-03-12"), "UTC")?.id).toBe("earlier");
		expect(termsInForceOn(rows, date("2026-03-20"), "UTC")).toBeNull();
		expect(confirmedTermsSpans(rows, "UTC").map((span) => span.terms.id)).toEqual(["earlier"]);
	});

	it("lets later terms win where confirmed terms overlap", () => {
		const open = row("open", utcMidnight("2026-01-01"), null);
		const next = row("next", utcMidnight("2026-02-01"), null);

		expect(
			confirmedTermsSpans([next, open], "UTC").map((span) => [
				span.terms.id,
				span.from.toString(),
				span.until?.toString() ?? null,
			]),
		).toEqual([
			["open", "2026-01-01", "2026-02-01"],
			["next", "2026-02-01", null],
		]);
	});

	it("drops terms whose calendar span is empty", () => {
		const replaced = row("replaced", utcMidnight("2026-04-01"), utcMidnight("2026-04-01"));
		const replacement = row("replacement", utcMidnight("2026-04-01"), null);

		expect(termsInForceOn([replaced, replacement], date("2026-04-01"), "UTC")?.id).toBe(
			"replacement",
		);
	});

	it("dates a rehire instant and a departure cutoff by the org-local calendar", () => {
		const departed = row(
			"departed",
			utcMidnight("2026-01-01"),
			new Date("2026-03-14T23:00:00.000Z"),
		);
		const rehired = row("rehired", new Date("2026-05-04T08:30:00.000Z"), null);
		const rows = [departed, rehired];

		expect(termsInForceOn(rows, date("2026-03-14"), "Europe/Berlin")?.id).toBe("departed");
		expect(termsInForceOn(rows, date("2026-03-15"), "Europe/Berlin")).toBeNull();
		expect(termsInForceOn(rows, date("2026-05-03"), "Europe/Berlin")).toBeNull();
		expect(termsInForceOn(rows, date("2026-05-04"), "Europe/Berlin")?.id).toBe("rehired");
	});
});
