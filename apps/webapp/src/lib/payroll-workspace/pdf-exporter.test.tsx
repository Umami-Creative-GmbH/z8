import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import { avvPdfText as pdfText } from "@/lib/avv/avv-pdf.test.fixture";
import {
	buildPayrollPeriodRead,
	type PayrollPeriodSources,
} from "@/lib/payroll-period/period-read";
import {
	attributeRecordsToLocalDays,
	type PayrollPeriodRecordSource,
	type PayrollPeriodRecordsByDay,
} from "@/lib/payroll-period/day-records";
import type { PayrollPeriodRead } from "@/lib/payroll-period/types";
import {
	exportPayrollPeriodToPDF,
	generatePayrollPDFFilename,
	type PayrollPdfTranslate,
} from "./pdf-exporter";
import type { PayrollWorkspaceSummary } from "./types";

function countPDFPages(pdf: Uint8Array): number {
	return (
		Buffer.from(pdf)
			.toString("latin1")
			.match(/\/Type \/Page\b/g)?.length ?? 0
	);
}

/** Tolgee's English fallback: the static default with `{name}` placeholders filled in. */
const englishT: PayrollPdfTranslate = (_key, defaultValue, params) =>
	interpolate(defaultValue, params);

function interpolate(text: string, params?: Record<string, string | number>): string {
	return text.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);
}

const anna = {
	id: "employee-1",
	name: "Anna Berg",
	employeeNumber: "E-1",
	teamName: "Ops",
	contractType: "fixed" as const,
	timezone: "Europe/Berlin",
};
const ben = { ...anna, id: "employee-2", name: "Ben Cole", employeeNumber: "E-2" };

function work(employeeId: string, date: string, minutes: number) {
	const startAt = Temporal.Instant.from(`${date}T07:00:00Z`);
	return {
		recordId: `${employeeId}-${date}`,
		employeeId,
		startAt,
		endExclusive: startAt.add({ minutes }),
		minutes,
	};
}

function settled(employeeId: string, date: string, paidMinutes: number) {
	return {
		id: `settled-${employeeId}-${date}`,
		employeeId,
		date,
		method: "manual" as const,
		payrollExportJobId: null,
		settledAt: "2026-11-06T10:00:00.000Z",
		paid: { creditedMinutes: paidMinutes, absences: [] },
	};
}

const weekdays = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

function periodRead(
	sources: Partial<PayrollPeriodSources> = {},
	period = { start: "2026-11-01", end: "2026-11-07", label: "Week 45" },
): PayrollPeriodRead {
	return buildPayrollPeriodRead({
		organizationId: "organization-a",
		period,
		generatedAt: Temporal.Instant.from("2026-11-07T12:00:00Z"),
		generatedBy: { id: "payroll-1", name: "Payroll User" },
		sources: {
			organizationName: "Acme GmbH",
			employees: [anna, ben],
			work: [
				work(anna.id, "2026-11-02", 480),
				work(anna.id, "2026-11-03", 570),
				work(anna.id, "2026-11-04", 480),
				work(ben.id, "2026-11-02", 240),
			],
			absences: [
				{
					id: "absence-1",
					employeeId: anna.id,
					categoryId: "vacation",
					categoryName: "Vacation",
					categoryType: "vacation",
					categoryColor: null,
					startDate: "2026-11-06",
					endDate: "2026-11-06",
					startPeriod: "am",
					endPeriod: "am",
					approvalState: "approved",
				},
			],
			blockers: [],
			requirements: new Map([
				[anna.id, Object.fromEntries(weekdays.map((date) => [date, { requiredMinutes: 480 }]))],
			]),
			holidays: new Map([
				[anna.id, [{ name: "Founders Day", startDate: "2026-11-05", endDate: "2026-11-05" }]],
			]),
			settledDays: [settled(anna.id, "2026-11-03", 480), settled(anna.id, "2026-11-04", 480)],
			...sources,
		},
	});
}

/** The day sheet pages of one employee: their page header names the employee. */
function daySheetPages(text: string, employeeName: string): string[] {
	return text.split("\n").filter((page) => page.includes(`Day sheet ${employeeName}`));
}

/** Builds the records loader's result from stored records, as it attributes them. */
function recordsByDay(
	read: PayrollPeriodRead,
	records: Array<{ employeeId: string } & PayrollPeriodRecordSource>,
	now = Temporal.Instant.from("2026-11-07T12:00:00Z"),
): PayrollPeriodRecordsByDay {
	return new Map(
		read.employees.map((employee) => [
			employee.id,
			attributeRecordsToLocalDays(
				records.filter((record) => record.employeeId === employee.id),
				{
					timezone: employee.timezone,
					startDate: read.period.start,
					endDate: read.period.end,
					now,
				},
			),
		]),
	);
}

function storedRecord(
	employeeId: string,
	id: string,
	startAt: string,
	endAt: string | null,
	overrides: Partial<PayrollPeriodRecordSource> = {},
): { employeeId: string } & PayrollPeriodRecordSource {
	const start = Temporal.Instant.from(startAt);
	const end = endAt ? Temporal.Instant.from(endAt) : null;
	return {
		employeeId,
		id,
		kind: "work",
		approvalState: "approved",
		startAt: start,
		endAt: end,
		durationMinutes: end ? start.until(end).total("minutes") : null,
		isPaid: null,
		...overrides,
	};
}

describe("payroll PDF day sheets", () => {
	it("gives each employee in scope a day sheet with a row per local day with entries", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);

		const [annaSheet] = daySheetPages(text, "Anna Berg");
		expect(annaSheet).toBeDefined();
		expect(daySheetPages(text, "Ben Cole")).toHaveLength(1);
		// Work on 2 to 4 November, a vacation morning on 6 November.
		for (const day of ["Mon\\s+11/2/2026", "Tue\\s+11/3/2026", "Wed\\s+11/4/2026"]) {
			expect(annaSheet).toMatch(new RegExp(day.replaceAll("/", "\\/")));
		}
		expect(annaSheet).toMatch(/Fri\s+11\/6\/2026.*Vacation \(AM\)/);
		// The weekend and the holiday without entries are left out, and the sheet says so.
		expect(annaSheet).not.toMatch(/Sun\s+11\/1\/2026/);
		expect(annaSheet).not.toMatch(/Thu\s+11\/5\/2026/);
		expect(annaSheet).not.toMatch(/Sat\s+11\/7\/2026/);
		expect(annaSheet).not.toContain("Founders Day");
		expect(annaSheet).toContain("Days without entries are left out.");
	});

	it("shows the holiday of a day with entries next to its absences", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(
				periodRead({
					work: [work(anna.id, "2026-11-05", 240)],
					absences: [
						{
							id: "absence-5",
							employeeId: anna.id,
							categoryId: "sick",
							categoryName: "Sick leave",
							categoryType: "sick",
							categoryColor: null,
							startDate: "2026-11-05",
							endDate: "2026-11-05",
							startPeriod: "pm",
							endPeriod: "pm",
							approvalState: "pending",
						},
					],
					settledDays: [],
				}),
				{ t: englishT, locale: "en" },
			),
		);

		expect(daySheetPages(text, "Anna Berg")[0]).toMatch(
			/Thu\s+11\/5\/2026.*4\.00 h.*Founders Day\s+Sick leave\s+\(PM,\s+pending\)/,
		);
	});

	it("ends each sheet with a total row matching the summary totals", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);

		// 480 + 570 + 480 minutes; 2,400 required on five weekdays.
		expect(daySheetPages(text, "Anna Berg")[0]).toMatch(/Total\s+25\.50 h\s+40\.00 h\s+-14\.50 h/);
		expect(daySheetPages(text, "Ben Cole")[0]).toMatch(/Total\s+4\.00 h/);
		const summaryPage = text.split("\n")[0];
		expect(summaryPage).toContain("25.50 h");
		expect(summaryPage).toContain("29.50 h");
	});

	it("marks settled and changed-since-settled days apart", async () => {
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);
		const sheet = daySheetPages(text, "Anna Berg")[0] ?? "";

		// 3 Nov was settled at 8 h and now has 9.5 h; 4 Nov is unchanged.
		expect(sheet).toMatch(/11\/3\/2026.*Changed\s+since\s+settled\s+\+1\.5 h/);
		expect(sheet).toMatch(/11\/4\/2026.*Settled/);
		expect(sheet).not.toMatch(/11\/2\/2026[^/]*Settled/);
	});

	it("uses the exporter's language and locale formatting", async () => {
		const german: Record<string, string> = {
			"payroll.pdf.daySheet.title": "Tagesblatt {name}",
			"payroll.pdf.daySheet.total": "Summe",
			"payroll.pdf.daySheet.settled": "Abgerechnet",
			"payroll.pdf.daySheet.changedSinceSettled": "Seit Abrechnung geändert",
			"payroll.pdf.summary.kicker": "Lohnabrechnungsprüfung",
			"payroll.pdf.summary.workedHours": "Gearbeitete Stunden",
		};
		const germanT: PayrollPdfTranslate = (key, defaultValue, params) =>
			interpolate(german[key] ?? defaultValue, params);

		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: germanT, locale: "de" }),
		);
		const sheet = text.split("\n").find((page) => page.includes("Tagesblatt Anna Berg")) ?? "";

		expect(text).toContain("Lohnabrechnungsprüfung");
		expect(text).toMatch(/Gearbeitete Stunden/i);
		expect(sheet).toContain("3.11.2026");
		expect(sheet).toMatch(/Summe\s+25,50 h/);
		expect(sheet).toMatch(/Seit\s+Abrechnung\s+geändert\s+\+1,5 h/);
		expect(sheet).toContain("Abgerechnet");
		expect(text).not.toContain("Day sheet");
	});

	it("repeats the page header when a long period flows across pages", async () => {
		const quarter = Array.from({ length: 90 }, (_, index) =>
			Temporal.PlainDate.from("2026-01-01").add({ days: index }).toString(),
		);
		const read = periodRead(
			{
				employees: [anna],
				work: quarter.map((date) => work(anna.id, date, 480)),
				absences: [],
				settledDays: [],
				requirements: new Map(),
				holidays: new Map(),
			},
			{ start: "2026-01-01", end: "2026-03-31", label: "Q1 2026" },
		);
		const pages = daySheetPages(
			await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" })),
			"Anna Berg",
		);

		expect(pages.length).toBeGreaterThan(1);
		for (const page of pages) {
			expect(page).toMatch(
				/Date\s+Clock in – out\s+Breaks\s+Worked\s+Required\s+Difference\s+Absence \/\s+holiday\s+Settlement/i,
			);
		}
	}, 15_000);
});

describe("payroll PDF day sheet clock times and breaks", () => {
	it("shows each work record's clock-in and clock-out and the breaks with their minutes", async () => {
		const read = periodRead();
		const records = recordsByDay(read, [
			// Berlin wall clock, UTC+1.
			storedRecord(anna.id, "w-1", "2026-11-02T07:02:00Z", "2026-11-02T11:00:00Z"),
			storedRecord(anna.id, "b-1", "2026-11-02T11:00:00Z", "2026-11-02T11:31:00Z", {
				kind: "break",
				isPaid: false,
			}),
			storedRecord(anna.id, "w-2", "2026-11-02T11:31:00Z", "2026-11-02T16:05:00Z"),
			storedRecord(anna.id, "b-2", "2026-11-02T14:00:00Z", "2026-11-02T14:10:00Z", {
				kind: "break",
				isPaid: true,
			}),
		]);

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en", records })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(
			/Mon\s+11\/2\/2026\s+08:02–12:00\s+12:31–17:05\s+12:00–12:31 \(31 min\)\s+15:00–15:10 \(10 min, paid\)\s+8\.00 h/,
		);
		expect(sheet).not.toContain("Not approved yet");
	});

	it("shows a clocked break, stored as the gap between two work records, in the Breaks column", async () => {
		const read = periodRead();
		// A clocked break closes the work at 12:00 and resumes it at 12:31, Berlin.
		const records = recordsByDay(read, [
			storedRecord(anna.id, "w-1", "2026-11-02T07:02:00Z", "2026-11-02T11:00:00Z"),
			storedRecord(anna.id, "w-2", "2026-11-02T11:31:00Z", "2026-11-02T16:05:00Z"),
		]);

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en", records })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(
			/Mon\s+11\/2\/2026\s+08:02–12:00\s+12:31–17:05\s+12:00–12:31 \(31 min\)\s+8\.00 h/,
		);
	});

	it("keeps a long absence category inside its column", async () => {
		const read = periodRead({
			absences: [
				{
					id: "absence-long",
					employeeId: anna.id,
					categoryId: "parental",
					categoryName: "Elternzeit/Mutterschutz",
					categoryType: "vacation",
					categoryColor: null,
					startDate: "2026-11-04",
					endDate: "2026-11-04",
					startPeriod: "full_day",
					endPeriod: "full_day",
					approvalState: "approved",
				},
			],
		});

		const pdf = await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" });
		const items = await pageTextItems(pdf, "Day sheet Anna Berg");
		const settlementColumn = items.find((item) => /^settlement$/i.test(item.str));
		const category = items.filter((item) => /Eltern|Mutter|schutz/.test(item.str));

		expect(settlementColumn).toBeDefined();
		expect(category.length).toBeGreaterThan(1);
		// Wrapped over lines, with a hyphen where a word is broken.
		expect(
			category
				.map((item) => item.str.trim())
				.join("")
				.replaceAll("-", ""),
		).toBe("Elternzeit/Mutterschutz");
		for (const item of category) {
			expect(item.x + item.width).toBeLessThan(settlementColumn?.x ?? 0);
		}
	});

	it("shows a record across local midnight on both days with the day it starts or ends", async () => {
		const read = periodRead();
		const records = recordsByDay(read, [
			// 22:00 on 2 November to 06:00 on 3 November, Berlin.
			storedRecord(anna.id, "night", "2026-11-02T21:00:00Z", "2026-11-03T05:00:00Z"),
		]);

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en", records })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(/Mon\s+11\/2\/2026\s+22:00–06:00 \(\+1\)/);
		expect(sheet).toMatch(/Tue\s+11\/3\/2026\s+22:00 \(-1\)–06:00/);
	});

	it("marks records not approved yet and shows a running record as open", async () => {
		const read = periodRead();
		const records = recordsByDay(read, [
			storedRecord(anna.id, "pending", "2026-11-02T07:00:00Z", "2026-11-02T11:00:00Z", {
				approvalState: "pending",
			}),
			storedRecord(anna.id, "running", "2026-11-04T08:00:00Z", null, {
				approvalState: "draft",
			}),
		]);

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en", records })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(/Mon\s+11\/2\/2026\s+08:00–12:00\*/);
		expect(sheet).toMatch(/Wed\s+11\/4\/2026\s+09:00–open\*/);
		expect(sheet).toContain("* Not approved yet (pending or draft)");
	});

	it("keeps a day without credited work that has a record, such as a pending one", async () => {
		const read = periodRead();
		const records = recordsByDay(read, [
			// Saturday 7 November: pending, so not credited.
			storedRecord(anna.id, "saturday", "2026-11-07T08:00:00Z", "2026-11-07T10:00:00Z", {
				approvalState: "pending",
			}),
		]);

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en", records })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(/Sat\s+11\/7\/2026\s+09:00–11:00\*\s+0\.00 h/);
	});

	it("leaves out a day settled with nothing on it", async () => {
		// 5 November has only a holiday and 7 November nothing; both were settled at no hours.
		const read = periodRead({
			settledDays: [
				settled(anna.id, "2026-11-03", 480),
				settled(anna.id, "2026-11-05", 0),
				settled(anna.id, "2026-11-07", 0),
			],
		});

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).not.toMatch(/Thu\s+11\/5\/2026/);
		expect(sheet).not.toMatch(/Sat\s+11\/7\/2026/);
		expect(sheet).not.toContain("Founders Day");
		// The total still counts every settled day.
		expect(sheet).toMatch(/Total.*3 settled/);
	});

	it("keeps a day changed since settled even once its entries are gone", async () => {
		// 5 November was settled at 8 h; its work was deleted since.
		const read = periodRead({ settledDays: [settled(anna.id, "2026-11-05", 480)] });

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(/Thu\s+11\/5\/2026\s+0\.00 h.*Changed\s+since\s+settled\s+-8 h/);
	});

	it("shows a running record on the day it started only, not on every day up to now", async () => {
		const read = periodRead({ work: [], absences: [], settledDays: [] });
		const records = recordsByDay(read, [
			// Started Monday 2 November and never stopped; now is Saturday noon.
			storedRecord(anna.id, "forgotten", "2026-11-02T08:00:00Z", null, {
				approvalState: "draft",
			}),
		]);

		const sheet =
			daySheetPages(
				await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en", records })),
				"Anna Berg",
			)[0] ?? "";

		expect(sheet).toMatch(/Mon\s+11\/2\/2026\s+09:00–open\*/);
		for (const day of ["Tue", "Wed", "Thu", "Fri", "Sat"]) {
			expect(sheet).not.toMatch(new RegExp(`${day}\\s+11\\/\\d\\/2026`));
		}
	});

	it("keeps the sheet of an employee without entries, with the total row", async () => {
		const read = periodRead({ work: [work(anna.id, "2026-11-02", 480)], absences: [] });

		const text = await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" }));
		const benSheet = daySheetPages(text, "Ben Cole");

		expect(benSheet).toHaveLength(1);
		expect(benSheet[0]).toMatch(/No entries in this period\s+Total\s+0\.00 h/);
		expect(benSheet[0]).toContain("Days without entries are left out.");
		expect(benSheet[0]).not.toMatch(/\d+\/\d+\/2026\s+0\.00 h/);
	});

	it("keeps the totals over the whole period when days are left out", async () => {
		// Anna's 2 November is credited 8 h but its records are not loaded: totals stay.
		const text = await pdfText(
			await exportPayrollPeriodToPDF(periodRead(), { t: englishT, locale: "en" }),
		);

		expect(daySheetPages(text, "Anna Berg")[0]).toMatch(
			/Total\s+25\.50 h\s+40\.00 h\s+-14\.50 h\s+0\.5 absence days\s+2 settled/,
		);
	});
});

/** The text items of the first page containing `marker`, with where each starts and its width. */
async function pageTextItems(
	pdf: Uint8Array,
	marker: string,
): Promise<Array<{ str: string; x: number; width: number }>> {
	const task = getDocument({ data: new Uint8Array(pdf) });
	const document = await task.promise;
	try {
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
			const content = await (await document.getPage(pageNumber)).getTextContent();
			const items = content.items.flatMap((item) =>
				"str" in item ? [{ str: item.str, x: item.transform[4] as number, width: item.width }] : [],
			);
			if (items.some((item) => item.str.includes(marker))) return items;
		}
		return [];
	} finally {
		await task.destroy();
	}
}

/** Each page's text and whether it is laid out in landscape. */
async function pdfPages(pdf: Uint8Array): Promise<Array<{ text: string; landscape: boolean }>> {
	const texts = (await pdfText(pdf)).split("\n");
	const task = getDocument({ data: new Uint8Array(pdf) });
	const document = await task.promise;
	try {
		const pages = [];
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
			const viewport = (await document.getPage(pageNumber)).getViewport({ scale: 1 });
			pages.push({
				text: texts[pageNumber - 1] ?? "",
				landscape: viewport.width > viewport.height,
			});
		}
		return pages;
	} finally {
		await task.destroy();
	}
}

const pendingSick = {
	id: "absence-2",
	employeeId: ben.id,
	categoryId: "sick",
	categoryName: "Sick leave",
	categoryType: "sick",
	categoryColor: null,
	startDate: "2026-11-03",
	endDate: "2026-11-04",
	startPeriod: "full_day" as const,
	endPeriod: "full_day" as const,
	approvalState: "pending" as const,
};
const annaVacation = {
	id: "absence-1",
	employeeId: anna.id,
	categoryId: "vacation",
	categoryName: "Vacation",
	categoryType: "vacation",
	categoryColor: null,
	startDate: "2026-11-06",
	endDate: "2026-11-06",
	startPeriod: "am" as const,
	endPeriod: "am" as const,
	approvalState: "approved" as const,
};

function calendarPages(pages: Array<{ text: string; landscape: boolean }>) {
	return pages.filter((page) => page.text.includes("Absence calendar"));
}

describe("payroll PDF absence calendar", () => {
	it("shows employees against the period's days in landscape, with category codes and a legend", async () => {
		const pages = await pdfPages(
			await exportPayrollPeriodToPDF(periodRead({ absences: [annaVacation, pendingSick] }), {
				t: englishT,
				locale: "en",
			}),
		);
		const calendar = calendarPages(pages);

		expect(calendar).toHaveLength(1);
		const [page] = calendar;
		expect(page?.landscape).toBe(true);
		// The date header: every day of the period, 1 to 7 November.
		expect(page?.text).toMatch(
			/Sun\s+1\s+Mon\s+2\s+Tue\s+3\s+Wed\s+4\s+Thu\s+5\s+Fri\s+6\s+Sat\s+7/,
		);
		// Anna has vacation in the morning of 6 Nov; Ben's sick leave on 3 and 4 Nov is pending.
		expect(page?.text).toMatch(/Anna Berg\s+VA\b/);
		expect(page?.text).toMatch(/Ben Cole\s+SL\*\s+SL\*/);
		// The legend explains every code, the halves and the pending marker.
		expect(page?.text).toMatch(/SL\s+Sick leave/);
		expect(page?.text).toMatch(/VA\s+Vacation/);
		expect(page?.text).toMatch(/AM.*PM/);
		expect(page?.text).toMatch(/\*\s+Pending, not approved yet/);
		// Portrait day sheets stay portrait.
		expect(pages.find((other) => other.text.includes("Day sheet Anna Berg"))?.landscape).toBe(
			false,
		);
	});

	it("splits a large scope across pages, one calendar per month, repeating the date header", async () => {
		const employees = Array.from({ length: 60 }, (_, index) => {
			const number = String(index + 1).padStart(2, "0");
			return { ...anna, id: `employee-${number}`, name: `Employee ${number}` };
		});
		const read = periodRead(
			{
				employees,
				work: [],
				absences: [
					{
						...annaVacation,
						employeeId: "employee-60",
						startDate: "2026-02-27",
						endDate: "2026-03-02",
						startPeriod: "full_day",
						endPeriod: "full_day",
					},
				],
				settledDays: [],
				requirements: new Map(),
				holidays: new Map(),
			},
			{ start: "2026-01-01", end: "2026-03-31", label: "Q1 2026" },
		);
		const calendar = calendarPages(
			await pdfPages(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" })),
		);

		const january = calendar.filter((page) => page.text.includes("1/1/2026 – 1/31/2026"));
		const february = calendar.filter((page) => page.text.includes("2/1/2026 – 2/28/2026"));
		const march = calendar.filter((page) => page.text.includes("3/1/2026 – 3/31/2026"));
		expect(january.length).toBeGreaterThan(1);
		expect(january.length + february.length + march.length).toBe(calendar.length);
		for (const page of calendar) {
			expect(page.landscape).toBe(true);
			expect(page.text).toMatch(/Employee\s+\w{3}\s+1\s+\w{3}\s+2\s+\w{3}\s+3/i);
		}
		expect(january[0]?.text).toContain("Employee 01");
		expect(january[0]?.text).not.toContain("Employee 60");
		expect(january.some((page) => page.text.includes("Employee 60"))).toBe(true);
		// 27 Feb to 2 Mar: two days at the end of February, two at the start of March.
		expect(february.map((page) => page.text).join(" ")).toMatch(/Employee 60\s+VA\s+VA\s/);
		expect(march.map((page) => page.text).join(" ")).toMatch(/Employee 60\s+VA\s+VA\s/);
	}, 30_000);

	it("is left out when the period has no absences", async () => {
		const pages = await pdfPages(
			await exportPayrollPeriodToPDF(periodRead({ absences: [] }), { t: englishT, locale: "en" }),
		);

		expect(calendarPages(pages)).toHaveLength(0);
		expect(pages.some((page) => page.text.includes("Absence list"))).toBe(false);
	});
});

describe("payroll PDF absence list", () => {
	it("lists every absence with employee, category, from–to, days counted and pending marker", async () => {
		const timedAppointment = {
			...annaVacation,
			id: "absence-3",
			categoryId: "appointment",
			categoryName: "Doctor appointment",
			categoryType: null,
			startDate: "2026-11-02",
			endDate: "2026-11-02",
			// A timed absence across noon: part of the day.
			startPeriod: "am" as const,
			endPeriod: "am" as const,
			startTime: "10:00:00",
			endTime: "14:00:00",
		};
		const pages = await pdfPages(
			await exportPayrollPeriodToPDF(
				periodRead({ absences: [pendingSick, annaVacation, timedAppointment] }),
				{ t: englishT, locale: "en" },
			),
		);
		const list = pages.filter((page) => page.text.includes("Absence list"));

		expect(list).toHaveLength(1);
		const text = list[0]?.text ?? "";
		expect(text).toMatch(/Employee\s+Category\s+From – to\s+Days counted\s+Status/i);
		// Sorted by employee, then start date.
		expect(text).toMatch(
			/Anna Berg\s+DA\s+Doctor appointment\s+11\/2\/2026, 10:00–14:00\s+0\.5\s+Approved.*Anna Berg\s+VA\s+Vacation\s+11\/6\/2026 \(AM\)\s+0\.5\s+Approved.*Ben Cole\s+SL\s+Sick leave\s+11\/3\/2026 – 11\/4\/2026\s+2\s+Pending/,
		);
		expect(text).toMatch(/1 pending absence blocks payroll/);
		expect(pages.some((page) => page.text.includes("Absence details"))).toBe(false);
	});

	it("uses the exporter's language for the calendar and the list", async () => {
		const german: Record<string, string> = {
			"payroll.pdf.absenceCalendar.title": "Abwesenheitskalender",
			"payroll.pdf.absenceCalendar.employee": "Mitarbeitende",
			"payroll.pdf.absenceCalendar.legend": "Legende",
			"payroll.pdf.absenceCalendar.pending": "Ausstehend, noch nicht genehmigt",
			"payroll.pdf.absenceList.title": "Abwesenheitsliste",
			"payroll.pdf.absenceList.days": "Gezählte Tage",
			"payroll.pdf.absenceList.pending": "Ausstehend",
			"payroll.pdf.absenceList.approved": "Genehmigt",
			"payroll.pdf.absence.am": "Vorm.",
		};
		const germanT: PayrollPdfTranslate = (key, defaultValue, params) =>
			interpolate(german[key] ?? defaultValue, params);
		const pages = await pdfPages(
			await exportPayrollPeriodToPDF(periodRead({ absences: [pendingSick, annaVacation] }), {
				t: germanT,
				locale: "de",
			}),
		);
		const calendar = pages.find((page) => page.text.includes("Abwesenheitskalender"));
		const list = pages.find((page) => page.text.includes("Abwesenheitsliste"))?.text ?? "";

		expect(calendar?.landscape).toBe(true);
		expect(calendar?.text).toMatch(/Mitarbeitende\s+So\.?\s+1\s+Mo\.?\s+2/i);
		expect(calendar?.text).toContain("Legende");
		expect(calendar?.text).toMatch(/\*\s+Ausstehend, noch nicht genehmigt/);
		expect(list).toMatch(/Gezählte Tage/i);
		expect(list).toMatch(/6\.11\.2026 \(Vorm\.\)\s+0,5\s+Genehmigt/);
		expect(list).toMatch(/3\.11\.2026 – 4\.11\.2026\s+2\s+Ausstehend/);
		expect(pages.some((page) => /Absence (calendar|list)/.test(page.text))).toBe(false);
	});
});

const summary: PayrollWorkspaceSummary = {
	organizationId: "organization-a",
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: "2026-06-30T12:00:00.000Z",
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 1, totalWorkedHours: 12.5, blockerCount: 1 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 12.5,
			absenceDaysByCategory: [
				{ categoryId: "sick", categoryName: "Sick", days: 1 },
				{ categoryId: "vacation", categoryName: "Vacation", days: 0.5 },
			],
			hasBlockers: true,
		},
	],
	absenceDetails: [
		{
			employeeId: "employee-1",
			categoryId: "vacation",
			categoryName: "Vacation",
			date: "2026-06-08",
			period: "am",
		},
		{
			employeeId: "employee-1",
			categoryId: "sick",
			categoryName: "Sick",
			date: "2026-06-03",
			period: "full_day",
		},
	],
	blockers: [
		{
			id: "blocker-1",
			employeeId: "employee-1",
			type: "missing_clock_out",
			label: "Missing clock-out",
			date: "2026-06-03",
			time: "09:00",
		},
	],
};

describe("payroll PDF exporter", () => {
	it("generates a stable filename", () => {
		expect(generatePayrollPDFFilename(summary)).toBe("payroll-acme-gmbh-2026-06-01-2026-06-30.pdf");
	});

	it("keeps the summary page with totals and blockers", async () => {
		const read = periodRead({
			blockers: [
				{
					id: "blocker-1",
					employeeId: ben.id,
					type: "missing_clock_out",
					label: "Missing clock-out",
					date: "2026-11-02",
					time: "09:00",
				},
			],
		});
		const summaryPage =
			(await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" }))).split(
				"\n",
			)[0] ?? "";

		expect(summaryPage).toContain("Payroll export audit");
		expect(summaryPage).toContain("Acme GmbH");
		expect(summaryPage).toMatch(/Employees\s+2/i);
		expect(summaryPage).toMatch(/Ben Cole.*Missing clock-out/);
		expect(summaryPage).toMatch(/Anna Berg.*\+1\.5 h since settled/);
		expect(summaryPage).toContain("Vacation: 0.5 d");
	});

	it("exports same-source blockers of different types without duplicate keys or omission", async () => {
		const sharedId = "11111111-1111-4111-8111-111111111111";
		const blocker = {
			id: sharedId,
			employeeId: ben.id,
			type: "missing_clock_out" as const,
			label: "Missing clock-out",
			date: "2026-11-02",
			time: "09:00",
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		try {
			const text = await pdfText(
				await exportPayrollPeriodToPDF(
					periodRead({ blockers: [blocker, { ...blocker, type: "pending_absence" }] }),
					{ t: englishT, locale: "en" },
				),
			);

			expect(text).toContain("Missing clock-out");
			expect(text).toContain("Pending absence");
			expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
				"Encountered two children with the same key",
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it("flows a long absence list across physical PDF pages, repeating its column header", async () => {
		const read = periodRead({
			employees: [anna],
			settledDays: [],
			absences: Array.from({ length: 60 }, (_, index) => ({
				id: `absence-${index}`,
				employeeId: anna.id,
				categoryId: `category-${String(index).padStart(2, "0")}`,
				categoryName: `Approved absence category ${index + 1}`,
				categoryType: null,
				categoryColor: null,
				startDate: "2026-11-03",
				endDate: "2026-11-03",
				startPeriod: "full_day" as const,
				endPeriod: "full_day" as const,
				approvalState: "approved" as const,
			})),
		});
		const text = await pdfText(await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" }));
		const absencePages = text.split("\n").filter((page) => page.includes("Absence list"));

		expect(absencePages.length).toBeGreaterThan(1);
		for (const page of absencePages) {
			expect(page).toMatch(/Employee\s+Category\s+From – to/i);
		}
		expect(absencePages.join(" ").match(/Approved absence category \d+/g)).toHaveLength(60);
	}, 15_000);

	it("paginates a large scope into one day sheet per employee", async () => {
		const employees = Array.from({ length: 100 }, (_, index) => {
			const number = String(index + 1).padStart(3, "0");
			return {
				...anna,
				id: `employee-${number}`,
				name: `Employee ${number}`,
				employeeNumber: `E-${number}`,
			};
		});
		const read = periodRead(
			{
				employees,
				work: employees.map((employee) => work(employee.id, "2026-11-02", 480)),
				absences: [],
				settledDays: [],
				requirements: new Map(),
				holidays: new Map(),
			},
			{ start: "2026-11-02", end: "2026-11-02", label: "2 Nov 2026" },
		);

		const pdf = await exportPayrollPeriodToPDF(read, { t: englishT, locale: "en" });

		// The summary's employee table, then exactly one sheet per employee.
		expect(countPDFPages(pdf)).toBeGreaterThanOrEqual(101);
		expect(countPDFPages(pdf)).toBeLessThan(108);
	}, 30_000);
});
