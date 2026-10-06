import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatUnits, STORED_AMOUNT_SCALE } from "./money";
import type { OfficialSource } from "./statutory-per-diem-defaults";

/**
 * Verified official foreign per diem tables ("Auslandsreisepauschalen", #611).
 * Each table is one annual BMF notice under § 9 Abs. 4a Satz 5 EStG: per
 * country, and for some countries per city, the allowance for a calendar day
 * of 24 hours' absence and for an arrival/departure day or a day of more than
 * 8 hours, in EUR. Meal deductions follow § 9 Abs. 4a Satz 8 EStG: 20 percent
 * (breakfast) and 40 percent (lunch, dinner) of the day's full-day amount.
 *
 * Nothing here applies on its own: a table only prices travel days once an
 * expense administrator adopts the statutory default that contains it as a
 * dated policy version, and only for days inside the table's edition. Rates
 * are transcribed from the official text and never estimated; a table for a
 * later year is a new, separately verified entry.
 */

export interface ForeignPerDiemPlace {
	/** Stable key within the country, e.g. "paris". */
	key: string;
	/** The place as the official table names it. */
	label: string;
	fullDay: string;
	partialDay: string;
}

export interface ForeignPerDiemCountry {
	/** ISO 3166-1 alpha-2 code (Kosovo: "XK"). */
	country: string;
	/** The country as the official table names it. */
	label: string;
	/** The country's amounts; for a country with places, those of "im Übrigen" (everywhere else). */
	fullDay: string;
	partialDay: string;
	places: readonly ForeignPerDiemPlace[];
}

export interface ForeignPerDiemTable {
	key: string;
	currency: "EUR";
	/** First and last calendar day (inclusive) the notice covers. */
	validFrom: string;
	validThrough: string;
	reference: string;
	version: string;
	sources: readonly OfficialSource[];
	verifiedOn: string;
	countries: readonly ForeignPerDiemCountry[];
	/** Countries the notice assigns another country's amounts ("gelten auch für"). */
	assignedCountries: Readonly<Record<string, string>>;
	/**
	 * Codes the trip's country list has for a place the table lists under
	 * another country (e.g. Hong Kong under China).
	 */
	codeAliases: Readonly<Record<string, { country: string; place: string }>>;
	/** States the notice does not list: the Luxembourg amounts apply (R 9.6 Abs. 3 Satz 2 LStR). */
	luxembourgFallback: readonly string[];
	/**
	 * Overseas and external territories the notice does not list, by their
	 * mother country, whose amounts apply (R 9.6 Abs. 3 Satz 2 LStR). Only
	 * territories whose mother country is unambiguous are listed; anything
	 * else is not resolved and needs a manual calculation.
	 */
	motherCountries: Readonly<Record<string, string>>;
}

type PlaceRow = readonly [key: string, label: string, fullDay: number, partialDay: number];
type CountryRow =
	| readonly [country: string, label: string, fullDay: number, partialDay: number]
	| readonly [
			country: string,
			label: string,
			fullDay: number,
			partialDay: number,
			places: readonly PlaceRow[],
	  ];

const euros = (amount: number): string => formatUnits(BigInt(amount * 100), STORED_AMOUNT_SCALE);

function countriesOf(rows: readonly CountryRow[]): ForeignPerDiemCountry[] {
	return rows.map(([country, label, fullDay, partialDay, places]) => ({
		country,
		label,
		fullDay: euros(fullDay),
		partialDay: euros(partialDay),
		places: (places ?? []).map(([key, placeLabel, placeFull, placePartial]) => ({
			key,
			label: placeLabel,
			fullDay: euros(placeFull),
			partialDay: euros(placePartial),
		})),
	}));
}

const BMF_FOREIGN_2026: OfficialSource = {
	label: "LStH 2026, Anhang 25 I (BMF 05.12.2025, IV C 5 - S 2353/00094/007/012, BStBl I S. 2078)",
	url: "https://lsth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-25/I/inhalt.html",
};
const LSTR_R_9_6: OfficialSource = {
	label: "LStH 2026, R 9.6 Abs. 3 LStR (unlisted states, territories, flights, ships)",
	url: "https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/4-Ueberschuss-d-Einnahmen-ueber-die-Werbungsk-8-9a/Paragraf-9/r-9-6.html",
};
const BMF_REISEKOSTEN_RZ_51_52: OfficialSource = {
	label: "LStH 2026, Anhang 25 III (BMF 25.11.2020, BStBl I S. 1228, Rz. 51-52)",
	url: "https://lsth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-25/III/inhalt.html",
};

/**
 * "Übersicht über die ab 1. Januar 2026 geltenden Pauschbeträge für
 * Verpflegungsmehraufwendungen und Übernachtungskosten im Ausland" of the BMF
 * letter of 5 December 2025 (BStBl I S. 2078), transcribed on 2026-10-07 from
 * the LStH 2026 edition (Anhang 25 I): every listed country and place with the
 * columns "bei einer Abwesenheitsdauer von mindestens 24 Stunden je
 * Kalendertag" and "für den An- und Abreisetag sowie bei einer
 * Abwesenheitsdauer von mehr als 8 Stunden je Kalendertag". The overnight
 * lump sums of the third column are not transcribed: Z8 does not pay them.
 * `__tests__/fixtures/bmf-2026-foreign-per-diem.txt` holds the published rows
 * and a test compares every entry with them.
 */
const BMF_2026_ROWS: readonly CountryRow[] = [
	["EG", "Ägypten", 50, 33],
	["ET", "Äthiopien", 44, 29],
	["GQ", "Äquatorialguinea", 42, 28],
	["AL", "Albanien", 33, 22],
	["DZ", "Algerien", 47, 32],
	["AD", "Andorra", 45, 30],
	["AO", "Angola", 40, 27],
	["AR", "Argentinien", 42, 28],
	["AM", "Armenien", 29, 20],
	["AZ", "Aserbaidschan", 44, 29],
	[
		"AU",
		"Australien",
		57,
		38,
		[
			["canberra", "Canberra", 74, 49],
			["sydney", "Sydney", 57, 38],
		],
	],
	["BH", "Bahrain", 48, 32],
	["BD", "Bangladesch", 46, 31],
	["BB", "Barbados", 54, 36],
	["BE", "Belgien", 59, 40],
	["BJ", "Benin", 40, 27],
	["BT", "Bhutan", 27, 18],
	["BO", "Bolivien", 46, 31],
	["BA", "Bosnien und Herzegowina", 32, 21],
	["BW", "Botsuana", 40, 27],
	[
		"BR",
		"Brasilien",
		46,
		31,
		[
			["brasilia", "Brasilia", 51, 34],
			["rio-de-janeiro", "Rio de Janeiro", 69, 46],
			["sao-paulo", "Sao Paulo", 46, 31],
		],
	],
	["BN", "Brunei", 45, 30],
	["BG", "Bulgarien", 38, 25],
	["BF", "Burkina Faso", 39, 26],
	["BI", "Burundi", 58, 39],
	["CL", "Chile", 44, 29],
	[
		"CN",
		"China",
		48,
		32,
		[
			["hongkong", "Hongkong", 83, 56],
			["peking", "Peking", 57, 38],
			["shanghai", "Shanghai", 48, 32],
		],
	],
	["CR", "Costa Rica", 60, 40],
	["CI", "Côte d’Ivoire", 60, 40],
	["DK", "Dänemark", 75, 50],
	["DO", "Dominikanische Republik", 50, 33],
	["DJ", "Dschibuti", 77, 52],
	["EC", "Ecuador", 27, 18],
	["SV", "El Salvador", 65, 44],
	["ER", "Eritrea", 46, 31],
	["EE", "Estland", 39, 26],
	["FJ", "Fidschi", 32, 21],
	["FI", "Finnland", 54, 36],
	[
		"FR",
		"Frankreich",
		53,
		36,
		[["paris", "Paris sowie die Departments 77, 78, 91 bis 95", 58, 39]],
	],
	["GA", "Gabun", 64, 43],
	["GM", "Gambia", 40, 27],
	["GE", "Georgien", 45, 30],
	["GH", "Ghana", 46, 31],
	["GR", "Griechenland", 36, 24, [["athen", "Athen", 40, 27]]],
	["GT", "Guatemala", 46, 31],
	["GN", "Guinea", 59, 40],
	["GW", "Guinea-Bissau", 32, 21],
	["HN", "Honduras", 57, 38],
	[
		"IN",
		"Indien",
		22,
		15,
		[
			["bangalore", "Bangalore", 42, 28],
			["chennai", "Chennai", 22, 15],
			["kalkutta", "Kalkutta", 32, 21],
			["mumbai", "Mumbai", 53, 36],
			["neu-delhi", "Neu Delhi", 46, 31],
		],
	],
	["ID", "Indonesien", 45, 30],
	["IR", "Iran", 33, 22],
	["IE", "Irland", 64, 43],
	["IS", "Island", 62, 41],
	["IL", "Israel", 59, 40],
	[
		"IT",
		"Italien",
		42,
		28,
		[
			["mailand", "Mailand", 42, 28],
			["rom", "Rom", 48, 32],
		],
	],
	["JM", "Jamaika", 39, 26],
	[
		"JP",
		"Japan",
		33,
		22,
		[
			["tokio", "Tokio", 50, 33],
			["osaka", "Osaka", 33, 22],
		],
	],
	["JO", "Jordanien", 57, 38],
	["KH", "Kambodscha", 42, 28],
	["CM", "Kamerun", 56, 37],
	[
		"CA",
		"Kanada",
		54,
		36,
		[
			["ottawa", "Ottawa", 62, 41],
			["toronto", "Toronto", 54, 36],
			["vancouver", "Vancouver", 63, 42],
		],
	],
	["CV", "Kap Verde", 38, 25],
	["KZ", "Kasachstan", 33, 22],
	["QA", "Katar", 81, 54],
	["KE", "Kenia", 48, 32],
	["KG", "Kirgisistan", 35, 24],
	["CO", "Kolumbien", 34, 23],
	["CG", "Kongo, Republik", 53, 36],
	["CD", "Kongo, Demokratische Republik", 65, 44],
	["KR", "Korea, Republik", 39, 26],
	["XK", "Kosovo", 24, 16],
	["HR", "Kroatien", 46, 31],
	["CU", "Kuba", 51, 34],
	["KW", "Kuwait", 63, 42],
	["LA", "Laos", 35, 24],
	["LS", "Lesotho", 28, 19],
	["LV", "Lettland", 46, 31],
	["LB", "Libanon", 69, 46],
	["LR", "Liberia", 65, 44],
	["LI", "Liechtenstein", 57, 38],
	["LT", "Litauen", 48, 32],
	["LU", "Luxemburg", 63, 42],
	["MG", "Madagaskar", 33, 22],
	["MW", "Malawi", 41, 28],
	["MY", "Malaysia", 36, 24],
	["MV", "Malediven", 70, 47],
	["ML", "Mali", 42, 28],
	["MT", "Malta", 59, 40],
	["MA", "Marokko", 41, 28],
	["MH", "Marshall Inseln", 45, 30],
	["MR", "Mauretanien", 35, 24],
	["MU", "Mauritius", 44, 29],
	["MX", "Mexiko", 40, 27],
	["MD", "Moldau, Republik", 26, 17],
	["MC", "Monaco", 52, 35],
	["MN", "Mongolei", 23, 16],
	["ME", "Montenegro", 32, 21],
	["MZ", "Mosambik", 51, 34],
	["MM", "Myanmar", 23, 16],
	["NA", "Namibia", 28, 19],
	["NP", "Nepal", 33, 22],
	["NZ", "Neuseeland", 58, 39],
	["NI", "Nicaragua", 46, 31],
	["NL", "Niederlande", 58, 39],
	["NE", "Niger", 42, 28],
	["NG", "Nigeria", 52, 35],
	["MK", "Nordmazedonien", 27, 18],
	["NO", "Norwegen", 75, 50],
	["AT", "Österreich", 50, 33],
	["OM", "Oman", 64, 43],
	["PK", "Pakistan", 41, 28],
	["PW", "Palau", 51, 34],
	["PA", "Panama", 41, 28],
	["PG", "Papua-Neuguinea", 59, 40],
	["PY", "Paraguay", 39, 26],
	["PE", "Peru", 52, 35],
	["PH", "Philippinen", 41, 28],
	[
		"PL",
		"Polen",
		34,
		23,
		[
			["breslau", "Breslau", 34, 23],
			["warschau", "Warschau", 40, 27],
		],
	],
	["PT", "Portugal", 32, 21],
	["RW", "Ruanda", 44, 29],
	["RO", "Rumänien", 38, 25],
	[
		"RU",
		"Russische Föderation",
		28,
		19,
		[
			["moskau", "Moskau", 30, 20],
			["st-petersburg", "St. Petersburg", 28, 19],
		],
	],
	["ZM", "Sambia", 38, 25],
	["WS", "Samoa", 39, 26],
	["SM", "San Marino", 34, 23],
	["ST", "São Tomé – Príncipe", 36, 24],
	[
		"SA",
		"Saudi-Arabien",
		56,
		37,
		[
			["djidda", "Djidda", 57, 38],
			["riad", "Riad", 56, 37],
		],
	],
	["SE", "Schweden", 66, 44],
	[
		"CH",
		"Schweiz",
		70,
		47,
		[
			["bern", "Bern", 82, 55],
			["genf", "Genf", 70, 47],
		],
	],
	["SN", "Senegal", 48, 32],
	["RS", "Serbien", 27, 18],
	["SL", "Sierra Leone", 57, 38],
	["ZW", "Simbabwe", 63, 42],
	["SG", "Singapur", 71, 48],
	["SK", "Slowakische Republik", 33, 22],
	["SI", "Slowenien", 38, 25],
	[
		"ES",
		"Spanien",
		34,
		23,
		[
			["barcelona", "Barcelona", 34, 23],
			["kanarische-inseln", "Kanarische Inseln", 36, 24],
			["madrid", "Madrid", 42, 28],
			["palma-de-mallorca", "Palma de Mallorca", 44, 29],
		],
	],
	["LK", "Sri Lanka", 36, 24],
	[
		"ZA",
		"Südafrika",
		29,
		20,
		[
			["kapstadt", "Kapstadt", 33, 22],
			["johannesburg", "Johannesburg", 36, 24],
		],
	],
	["SS", "Südsudan", 51, 34],
	["TJ", "Tadschikistan", 27, 18],
	["TW", "Taiwan", 51, 34],
	["TZ", "Tansania", 44, 29],
	["TH", "Thailand", 36, 24],
	["TG", "Togo", 36, 24],
	["TO", "Tonga", 29, 20],
	["TT", "Trinidad und Tobago", 66, 44],
	["TD", "Tschad", 42, 28],
	["CZ", "Tschechische Republik", 32, 21],
	[
		"TR",
		"Türkei",
		24,
		16,
		[
			["ankara", "Ankara", 32, 21],
			["izmir", "Izmir", 44, 29],
		],
	],
	["TN", "Tunesien", 40, 27],
	["TM", "Turkmenistan", 28, 19],
	["UG", "Uganda", 45, 30],
	["UA", "Ukraine", 33, 22],
	["HU", "Ungarn", 32, 21],
	["UY", "Uruguay", 40, 27],
	["UZ", "Usbekistan", 32, 21],
	["VA", "Vatikanstaat", 48, 32],
	["VE", "Venezuela", 51, 34],
	["AE", "Vereinigte Arabische Emirate", 81, 54],
	[
		"US",
		"Vereinigte Staaten von Amerika (USA)",
		59,
		40,
		[
			["atlanta", "Atlanta", 77, 52],
			["boston", "Boston", 63, 42],
			["chicago", "Chicago", 65, 44],
			["houston", "Houston", 62, 41],
			["los-angeles", "Los Angeles", 64, 43],
			["miami", "Miami", 65, 44],
			["new-york-city", "New York City", 66, 44],
			["san-francisco", "San Francisco", 59, 40],
			["washington-dc", "Washington, D. C.", 66, 44],
		],
	],
	[
		"GB",
		"Vereinigtes Königreich von Großbritannien und Nordirland",
		52,
		35,
		[["london", "London", 66, 44]],
	],
	["VN", "Vietnam", 36, 24],
	["BY", "Weißrussland", 21, 14],
	["CF", "Zentralafrikanische Republik", 53, 36],
	["CY", "Zypern", 42, 28],
];

/**
 * The BMF notice for travel days in 2026. Its text also states (checked on
 * 2026-10-07): the Philippine amounts apply to Micronesia, and the amounts of
 * Trinidad and Tobago to Antigua and Barbuda, Dominica, Grenada, Guyana,
 * St. Kitts and Nevis, St. Lucia, St. Vincent and the Grenadines and
 * Suriname; unlisted countries take the Luxembourg amounts and unlisted
 * overseas and external territories those of the mother country.
 */
export const BMF_FOREIGN_PER_DIEM_2026: ForeignPerDiemTable = {
	key: "de-bmf-foreign-per-diem-2026",
	currency: "EUR",
	validFrom: "2026-01-01",
	validThrough: "2026-12-31",
	reference:
		"§ 9 Abs. 4a Satz 5 and 8 EStG; BMF letter of 05.12.2025 (BStBl I S. 2078); R 9.6 Abs. 3 LStR; BMF letter of 25.11.2020 (BStBl I S. 1228), Rz. 51-52",
	version: "LStH 2026, Anhang 25 I",
	sources: [BMF_FOREIGN_2026, LSTR_R_9_6, BMF_REISEKOSTEN_RZ_51_52],
	verifiedOn: "2026-10-07",
	countries: countriesOf(BMF_2026_ROWS),
	assignedCountries: {
		FM: "PH",
		AG: "TT",
		DM: "TT",
		GD: "TT",
		GY: "TT",
		KN: "TT",
		LC: "TT",
		VC: "TT",
		SR: "TT",
	},
	codeAliases: {
		HK: { country: "CN", place: "hongkong" },
		IC: { country: "ES", place: "kanarische-inseln" },
	},
	// UN member states the notice neither lists nor assigns.
	luxembourgFallback: [
		"AF",
		"BS",
		"BZ",
		"HT",
		"IQ",
		"KI",
		"KM",
		"KP",
		"LY",
		"NR",
		"SB",
		"SC",
		"SD",
		"SO",
		"SY",
		"SZ",
		"TL",
		"TV",
		"VU",
		"YE",
	],
	motherCountries: {
		// France: overseas departments, collectivities and territories.
		BL: "FR",
		GF: "FR",
		GP: "FR",
		MF: "FR",
		MQ: "FR",
		NC: "FR",
		PF: "FR",
		PM: "FR",
		RE: "FR",
		TF: "FR",
		WF: "FR",
		YT: "FR",
		// United States: territories.
		AS: "US",
		GU: "US",
		MP: "US",
		PR: "US",
		UM: "US",
		VI: "US",
		// United Kingdom: overseas territories.
		AC: "GB",
		AI: "GB",
		BM: "GB",
		FK: "GB",
		GI: "GB",
		GS: "GB",
		IO: "GB",
		KY: "GB",
		MS: "GB",
		PN: "GB",
		SH: "GB",
		TA: "GB",
		TC: "GB",
		VG: "GB",
		// Kingdom of the Netherlands: Caribbean parts.
		AW: "NL",
		BQ: "NL",
		CW: "NL",
		SX: "NL",
		// Denmark: Greenland and the Faroe Islands.
		FO: "DK",
		GL: "DK",
		// Norway: Svalbard and Jan Mayen, Bouvet Island.
		BV: "NO",
		SJ: "NO",
		// Australia: external territories.
		CC: "AU",
		CX: "AU",
		HM: "AU",
		NF: "AU",
		// New Zealand: Tokelau.
		TK: "NZ",
		// Finland: Åland.
		AX: "FI",
	},
};

export const FOREIGN_PER_DIEM_TABLES: readonly ForeignPerDiemTable[] = [BMF_FOREIGN_PER_DIEM_2026];

export function findForeignPerDiemTable(key: string): ForeignPerDiemTable | null {
	return FOREIGN_PER_DIEM_TABLES.find((table) => table.key === key) ?? null;
}

/** The verified table covering every one of `dates`, if one does. */
export function foreignPerDiemTableCovering(dates: readonly string[]): ForeignPerDiemTable | null {
	return (
		FOREIGN_PER_DIEM_TABLES.find((table) =>
			dates.every((date) => foreignPerDiemTableCovers(table, date)),
		) ?? null
	);
}

export function foreignPerDiemTableCovers(table: ForeignPerDiemTable, date: string): boolean {
	const day = parsePlainDate(date);
	return (
		comparePlainDates(day, parsePlainDate(table.validFrom)) >= 0 &&
		comparePlainDates(day, parsePlainDate(table.validThrough)) <= 0
	);
}

/** A rate area of a per diem policy: "DE", a country ("FR") or a listed place ("FR:paris"). */
export function foreignAreaKey(country: string, place: string | null): string {
	return place ? `${country}:${place}` : country;
}

/** Amounts of one area in a per diem policy version, at two decimals. */
export interface ForeignPerDiemRates {
	fullDay: string;
	partialDay: string;
	breakfastDeduction: string;
	lunchDeduction: string;
	dinnerDeduction: string;
}

const PERCENT = BigInt(100);

function share(fullDay: string, percent: number): string {
	const [whole = "0", cents = "00"] = fullDay.split(".");
	const units = BigInt(whole) * PERCENT + BigInt(cents.padEnd(2, "0").slice(0, 2));
	const product = units * BigInt(percent);
	// Whole-euro amounts make 20 and 40 percent exact to the cent.
	if (product % PERCENT !== BigInt(0)) throw new RangeError(`Inexact deduction of ${fullDay}`);
	return formatUnits(product / PERCENT, STORED_AMOUNT_SCALE);
}

/** The amounts of a full-day/partial-day pair with the statutory meal deductions (Satz 8). */
export function foreignRatesOf(entry: {
	fullDay: string;
	partialDay: string;
}): ForeignPerDiemRates {
	return {
		fullDay: entry.fullDay,
		partialDay: entry.partialDay,
		breakfastDeduction: share(entry.fullDay, 20),
		lunchDeduction: share(entry.fullDay, 40),
		dinnerDeduction: share(entry.fullDay, 40),
	};
}

/** Every area of a table with its amounts: each country ("im Übrigen") and each listed place. */
export function foreignTableRates(table: ForeignPerDiemTable): Record<string, ForeignPerDiemRates> {
	const rates: Record<string, ForeignPerDiemRates> = {};
	for (const country of table.countries) {
		rates[foreignAreaKey(country.country, null)] = foreignRatesOf(country);
		for (const place of country.places) {
			rates[foreignAreaKey(country.country, place.key)] = foreignRatesOf(place);
		}
	}
	return rates;
}

export function findForeignCountry(
	table: ForeignPerDiemTable,
	country: string,
): ForeignPerDiemCountry | null {
	return table.countries.find((entry) => entry.country === country) ?? null;
}
