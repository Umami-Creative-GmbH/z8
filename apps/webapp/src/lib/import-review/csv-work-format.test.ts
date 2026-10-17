import { describe, expect, it } from "vitest";
import { csvWorkTemplate, parseCsvWorkUpload } from "./csv-work-format";

describe("CSV completed-work normalization", () => {
	it("preserves an explicitly supplied event offset instead of the upload timezone", () => {
		const upload = parseCsvWorkUpload(
			"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00:00+02:00,2026-07-22T10:00:00-04:00\n",
			"Europe/Berlin",
		);
		expect(upload.rows[0]).toMatchObject({
			rowNumber: 2,
			error: null,
			normalized: {
				personnelNumber: "0042",
				start: {
					at: "2026-07-22T06:00:00Z",
					capture: {
						utcOffsetMinutes: 120,
						timezone: "+02:00",
						timezoneSource: "csv_import",
					},
				},
				end: {
					at: "2026-07-22T14:00:00Z",
					capture: {
						utcOffsetMinutes: -240,
						timezone: "-04:00",
						timezoneSource: "csv_import",
					},
				},
				vehicle: null,
			},
		});
	});
});

it("interprets local work in the chosen zone and rejects both DST gaps and folds", () => {
	const csv =
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00,2026-07-22T09:00\n0042,2026-03-29T02:30,2026-03-29T04:00\n0042,2026-10-25T02:30,2026-10-25T04:00\n";
	const upload = parseCsvWorkUpload(csv, "Europe/Berlin");
	expect(upload.rows[0]?.normalized?.start).toEqual({
		at: "2026-07-22T06:00:00Z",
		capture: {
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			timezoneSource: "csv_import",
		},
	});
	expect(upload.rows.slice(1).map((row) => row.normalized)).toEqual([
		null,
		null,
	]);
	expect(upload.rows.slice(1).every((row) => row.error !== null)).toBe(true);
});

it("derives whole-kilometre vehicle use without discarding contradictory supplied values", () => {
	const upload = parseCsvWorkUpload(
		"personnel_number,starts_at,ends_at,vehicle_kind,licence_plate,odometer_start_km,odometer_end_km,distance_km\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z,organization,m-ab 1234,100,145,45\n0042,2026-07-23T08:00Z,2026-07-23T09:00Z,own,,,,30\n0042,2026-07-24T08:00Z,2026-07-24T09:00Z,own,,100,145,46\n0042,2026-07-25T08:00Z,2026-07-25T09:00Z,own,,100,,30\n0042,2026-07-26T08:00Z,2026-07-26T09:00Z,,,,,30\n0042,2026-07-27T08:00Z,2026-07-27T09:00Z,own,,100,,\n",
	);
	expect(upload.rows[0]?.normalized?.vehicle).toEqual({
		vehicle: { kind: "organization", licencePlate: "m-ab 1234" },
		startKm: 100,
		endKm: 145,
		distanceKm: 45,
	});
	expect(upload.rows[1]?.normalized?.vehicle).toEqual({
		vehicle: { kind: "own" },
		startKm: null,
		endKm: null,
		distanceKm: 30,
	});
	expect(upload.rows.slice(2, 5).every((row) => row.error !== null)).toBe(true);
	expect(upload.rows[5]?.normalized?.vehicle).toMatchObject({
		startKm: 100,
		endKm: null,
		distanceKm: null,
	});
});

it.each([
	"",
	"personnel_number,starts_at\n0042,2026-07-22T08:00Z\n",
	"personnel_number,starts_at,ends_at,starts_at\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z,2026-07-22T08:00Z\n",
	"personnel_number,starts_at,ends_at,project\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z,Secret\n",
	"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00Z\n",
])(
	"rejects unusable or unsupported file structure before staging work",
	(csv) => {
		expect(() => parseCsvWorkUpload(csv)).toThrow();
	},
);

it.each([
	["", "2026-07-22T08:00Z", "2026-07-22T09:00Z"],
	["0042", "2026-07-22T10:00Z", "2026-07-22T09:00Z"],
	["0042", "2026-07-22T08:00Z", "2026-07-22T08:00Z"],
	["0042", "2026-07-22T08:00", "2026-07-22T09:00"],
	["0042", "2026-07-22T08:00:00.000001Z", "2026-07-22T09:00Z"],
])(
	"keeps invalid source rows reviewable without producing completed work",
	(personnel, start, end) => {
		const upload = parseCsvWorkUpload(
			`personnel_number,starts_at,ends_at\n${personnel},${start},${end}\n`,
		);
		expect(upload.rows[0]).toMatchObject({
			normalized: null,
			error: expect.any(String),
		});
	},
);

it("provides a downloadable template whose example rows can be normalized", () => {
	const upload = parseCsvWorkUpload(csvWorkTemplate());
	expect(upload.rows.length).toBeGreaterThan(0);
	expect(
		upload.rows.every((row) => row.normalized !== null && row.error === null),
	).toBe(true);
});
