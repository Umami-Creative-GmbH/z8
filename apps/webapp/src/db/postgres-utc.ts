import type { PoolConfig } from "pg";
import { defaults, types } from "pg";

const TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;
const UTC_SESSION_OPTION = "-c timezone=UTC";
const UTC_SESSION_OPTION_PATTERN = /(?:^|\s)-c\s+timezone=UTC(?:\s|$)/;
const TIMESTAMP_PATTERN =
	/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?: (BC))?$/;

function parseTimestampWithoutTimeZoneAsUtc(value: string): Date | number {
	if (value === "infinity") {
		return Infinity;
	}
	if (value === "-infinity") {
		return -Infinity;
	}

	const match = TIMESTAMP_PATTERN.exec(value);
	if (!match) {
		throw new Error(`Invalid PostgreSQL timestamp without time zone: ${value}`);
	}

	const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, era] =
		match;
	const parsedYear = Number.parseInt(yearText, 10);
	const year = era === "BC" ? 1 - parsedYear : parsedYear;
	const month = Number.parseInt(monthText, 10);
	const day = Number.parseInt(dayText, 10);
	const hour = Number.parseInt(hourText, 10);
	const minute = Number.parseInt(minuteText, 10);
	const second = Number.parseInt(secondText, 10);
	const millisecond = Number.parseInt((fractionText ?? "").padEnd(3, "0").slice(0, 3) || "0", 10);
	const timestamp = new Date(0);

	timestamp.setUTCFullYear(year, month - 1, day);
	timestamp.setUTCHours(hour, minute, second, millisecond);

	if (
		!Number.isFinite(timestamp.getTime()) ||
		timestamp.getUTCFullYear() !== year ||
		timestamp.getUTCMonth() !== month - 1 ||
		timestamp.getUTCDate() !== day ||
		timestamp.getUTCHours() !== hour ||
		timestamp.getUTCMinutes() !== minute ||
		timestamp.getUTCSeconds() !== second
	) {
		throw new Error(`Invalid PostgreSQL timestamp without time zone: ${value}`);
	}

	return timestamp;
}

export function configurePostgresUtcTypes(): void {
	defaults.parseInputDatesAsUTC = true;
	types.setTypeParser(TIMESTAMP_WITHOUT_TIME_ZONE_OID, parseTimestampWithoutTimeZoneAsUtc);
}

export function withUtcPostgresSession(config: PoolConfig): PoolConfig {
	const options = config.options?.trim();

	return {
		...config,
		options:
			options && UTC_SESSION_OPTION_PATTERN.test(options)
				? options
				: options
					? `${options} ${UTC_SESSION_OPTION}`
					: UTC_SESSION_OPTION,
	};
}
