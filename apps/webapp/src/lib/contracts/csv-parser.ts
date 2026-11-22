import type { DayOfWeek } from "./types";

export interface ParsedCsvRow {
	/** 1-based line/record number in the CSV (header is 1, first data row is 2). */
	readonly rowNumber: number;
	/** Canonicalized header key -> trimmed string value. */
	readonly values: Readonly<Record<string, string>>;
}

export interface ParsedCsvDocument {
	readonly delimiter: "," | ";";
	readonly rawHeaders: readonly string[];
	readonly headers: readonly string[];
	readonly rows: readonly ParsedCsvRow[];
}

export interface ParseCsvOptions {
	readonly delimiter?: "," | ";";
}

const DAY_ALIASES: Readonly<Record<string, DayOfWeek>> = {
	mon: "monday",
	monday: "monday",
	mo: "monday",
	tue: "tuesday",
	tues: "tuesday",
	tuesday: "tuesday",
	di: "tuesday",
	wed: "wednesday",
	wednesday: "wednesday",
	mi: "wednesday",
	thu: "thursday",
	thur: "thursday",
	thurs: "thursday",
	thursday: "thursday",
	do: "thursday",
	fri: "friday",
	friday: "friday",
	fr: "friday",
	sat: "saturday",
	saturday: "saturday",
	sa: "saturday",
	sun: "sunday",
	sunday: "sunday",
	so: "sunday",
};

const HEADER_ALIASES: Readonly<Record<string, string>> = {
	// Employee identity
	employee_id: "employee_id",
	employeeid: "employee_id",
	id: "employee_id",
	employee_number: "employee_number",
	employeenumber: "employee_number",
	personnel_number: "employee_number",
	personnelnumber: "employee_number",
	personalnummer: "employee_number",
	email: "email",
	work_email: "email",
	user_email: "email",
	// Dates
	effective_from_date: "effective_from_date",
	effective_from: "effective_from_date",
	valid_from_date: "effective_from_date",
	valid_from: "effective_from_date",
	effective_date: "effective_from_date",
	last_working_day: "last_working_day",
	leaving_date: "last_working_day",
	departure_date: "last_working_day",
	end_date: "last_working_day",
	austrittsdatum: "last_working_day",
	// Contract operational fields
	work_policy_id: "work_policy_id",
	workpolicyid: "work_policy_id",
	work_policy: "work_policy_name",
	work_policy_name: "work_policy_name",
	policy_name: "work_policy_name",
	clear_personal_policy_pin: "clear_personal_policy_pin",
	weekly_contract_minutes: "weekly_contract_minutes",
	weekly_minutes: "weekly_contract_minutes",
	weekly_hours: "weekly_hours",
	weekly_contract_hours: "weekly_hours",
	schedule_mode: "schedule_mode",
	custom_days: "custom_days",
	work_model: "work_model",
	presence_override: "presence_override",
	balance_mode: "balance_mode",
	schedule_source: "schedule_source",
	// Employee-owned legal / pay / statutory fields
	contract_type: "contract_type",
	hourly_rate: "hourly_rate",
	hourly_wage: "hourly_rate",
	currency: "currency",
	employment_profile: "employment_profile",
	arbzg_scope: "arbzg_scope",
	on_call_hours_kind: "on_call_hours_kind",
	on_call_weekly_minutes: "on_call_weekly_minutes",
	on_call_weekly_hours: "on_call_weekly_hours",
	on_call_daily_minutes: "on_call_daily_minutes",
	change_reason: "change_reason",
	reason: "reason",
	// Leaving-date specific fields
	departure_mode: "departure_mode",
	mode: "departure_mode",
	replacement_employee_id: "replacement_employee_id",
	replacement_employee_number: "replacement_employee_number",
	replacement_email: "replacement_email",
	acknowledge_unassigned_duties: "acknowledge_unassigned_duties",
};

/**
 * Normalizes a raw CSV header label into a canonical snake_case key.
 */
export function normalizeCsvHeader(raw: string): string {
	const cleaned = raw
		.replace(/^\uFEFF/, "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return HEADER_ALIASES[cleaned] ?? cleaned;
}

/**
 * Auto-detects comma vs semicolon delimiter from the first non-empty line,
 * ignoring delimiters inside quoted strings.
 */
export function detectCsvDelimiter(text: string): "," | ";" {
	const firstLine = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/, 1)[0] ?? "";
	let inQuotes = false;
	let commas = 0;
	let semicolons = 0;

	for (let i = 0; i < firstLine.length; i++) {
		const ch = firstLine[i];
		if (ch === '"') {
			if (inQuotes && firstLine[i + 1] === '"') {
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (!inQuotes) {
			if (ch === ",") commas += 1;
			else if (ch === ";") semicolons += 1;
		}
	}

	return semicolons > commas ? ";" : ",";
}

/**
 * RFC-4180 compliant CSV parser supporting UTF-8 BOM, CRLF/LF/CR newlines,
 * quoted fields with escaped quotes (`""`), embedded newlines, and comma/semicolon delimiters.
 */
export function parseCsvText(rawText: string, options: ParseCsvOptions = {}): ParsedCsvDocument {
	const text = rawText.replace(/^\uFEFF/, "");
	const delimiter = options.delimiter ?? detectCsvDelimiter(text);

	const records: { rowNumber: number; fields: string[] }[] = [];
	let fields: string[] = [];
	let current = "";
	let inQuotes = false;
	let recordStartLine = 1;
	let lineNumber = 1;

	const pushRecord = () => {
		fields.push(current);
		current = "";
		const isAllBlank = fields.every((f) => f.trim() === "");
		if (!isAllBlank) {
			records.push({ rowNumber: recordStartLine, fields });
		}
		fields = [];
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];

		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					current += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				if (ch === "\n") lineNumber += 1;
				current += ch;
			}
			continue;
		}

		if (ch === '"') {
			if (current.length === 0) {
				inQuotes = true;
			} else {
				current += ch;
			}
		} else if (ch === delimiter) {
			fields.push(current);
			current = "";
		} else if (ch === "\r" || ch === "\n") {
			if (ch === "\r" && text[i + 1] === "\n") {
				i += 1;
			}
			pushRecord();
			lineNumber += 1;
			recordStartLine = lineNumber;
		} else {
			current += ch;
		}
	}

	if (inQuotes) {
		throw new Error(`Unterminated quoted field starting on line ${recordStartLine}`);
	}

	if (current.length > 0 || fields.length > 0) {
		pushRecord();
	}

	if (records.length === 0) {
		return { delimiter, rawHeaders: [], headers: [], rows: [] };
	}

	const headerRecord = records[0];
	const rawHeaders = headerRecord.fields.map((h) => h.trim());
	const headers = rawHeaders.map(normalizeCsvHeader);

	const rows: ParsedCsvRow[] = [];
	for (let r = 1; r < records.length; r++) {
		const rec = records[r];
		const values: Record<string, string> = {};
		for (let c = 0; c < headers.length; c++) {
			const key = headers[c];
			if (!key) continue;
			const rawValue = (rec.fields[c] ?? "").trim();
			// Keep first non-empty value when aliases collide
			if (!(key in values) || values[key] === "") {
				values[key] = rawValue;
			}
		}
		rows.push({ rowNumber: rec.rowNumber, values });
	}

	return { delimiter, rawHeaders, headers, rows };
}

/**
 * Parses a boolean cell value ("true"/"yes"/"1"/"ja" -> true, "false"/"no"/"0"/"nein" -> false).
 */
export function parseCsvBoolean(raw: string | undefined): boolean | null {
	if (raw === undefined || raw.trim() === "") return null;
	const lower = raw.trim().toLowerCase();
	if (lower === "true" || lower === "yes" || lower === "1" || lower === "ja") return true;
	if (lower === "false" || lower === "no" || lower === "0" || lower === "nein") return false;
	throw new Error(`Invalid boolean value "${raw}"`);
}

/**
 * Parses a decimal number accepting standard dot or single comma decimal separator when unambiguous.
 */
export function parseCsvNumber(raw: string | undefined): number | null {
	if (raw === undefined || raw.trim() === "") return null;
	const normalized = raw.trim().replace(",", ".");
	if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
		throw new Error(`Invalid numeric value "${raw}"`);
	}
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid numeric value "${raw}"`);
	}
	return parsed;
}

/**
 * Parses custom working days from either a JSON array or compact syntax:
 * e.g. `mon:480,tue:480,wed:480,thu:480,fri:240@09:00` or `mon:8h@09:00|tue:8h|fri:4h`.
 */
export function parseCsvCustomDays(raw: string | undefined):
	| readonly {
			dayOfWeek: DayOfWeek;
			minutesPerDay: number;
			isWorkDay: boolean;
			latestClockIn: string | null;
	  }[]
	| null {
	if (raw === undefined || raw.trim() === "") return null;
	const trimmed = raw.trim();

	if (trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed)) {
			throw new Error("custom_days JSON must be an array");
		}
		return parsed.map((entry) => {
			if (!entry || typeof entry !== "object") {
				throw new Error("Invalid custom_days JSON element");
			}
			const record = entry as Record<string, unknown>;
			const dayKey = String(record.dayOfWeek ?? record.day ?? "")
				.trim()
				.toLowerCase();
			const dayOfWeek = DAY_ALIASES[dayKey];
			if (!dayOfWeek) {
				throw new Error(`Unknown day of week "${String(record.dayOfWeek ?? record.day ?? "")}"`);
			}
			const minutesPerDay = Number(record.minutesPerDay ?? record.minutes ?? 0);
			const isWorkDay =
				record.isWorkDay !== undefined ? Boolean(record.isWorkDay) : minutesPerDay > 0;
			const latestClockIn =
				typeof record.latestClockIn === "string" && record.latestClockIn.trim() !== ""
					? record.latestClockIn.trim()
					: null;
			return { dayOfWeek, minutesPerDay, isWorkDay, latestClockIn };
		});
	}

	const tokens = trimmed
		.split(/[|,]/)
		.map((t) => t.trim())
		.filter(Boolean);
	const result: {
		dayOfWeek: DayOfWeek;
		minutesPerDay: number;
		isWorkDay: boolean;
		latestClockIn: string | null;
	}[] = [];

	for (const token of tokens) {
		const match = token.match(
			/^([a-zA-Z]+)\s*:\s*(\d+(?:[.,]\d+)?)(h|m|min)?(?:\s*@\s*(\d{2}:\d{2}))?$/i,
		);
		if (!match) {
			throw new Error(
				`Invalid custom_days entry "${token}". Expected e.g. mon:480 or mon:8h@09:00`,
			);
		}
		const dayOfWeek = DAY_ALIASES[match[1].toLowerCase()];
		if (!dayOfWeek) {
			throw new Error(`Unknown day of week "${match[1]}"`);
		}
		const rawNum = Number(match[2].replace(",", "."));
		const unit = (match[3] ?? "m").toLowerCase();
		const minutesPerDay = unit === "h" ? Math.round(rawNum * 60) : Math.round(rawNum);
		const latestClockIn = match[4] ?? null;
		result.push({
			dayOfWeek,
			minutesPerDay,
			isWorkDay: minutesPerDay > 0,
			latestClockIn,
		});
	}

	return result;
}
