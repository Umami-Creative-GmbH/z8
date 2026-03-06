import {
	TIME_RECORD_VALIDATION_MESSAGES,
	type TimeRecordValidationCode,
	type TimeRecordValidationInput,
} from "./types";

export class TimeRecordValidationError extends Error {
	readonly code: TimeRecordValidationCode;

	constructor(code: TimeRecordValidationCode) {
		super(TIME_RECORD_VALIDATION_MESSAGES[code]);
		this.name = "TimeRecordValidationError";
		this.code = code;
	}
}

function throwValidationError(code: TimeRecordValidationCode): never {
	throw new TimeRecordValidationError(code);
}

export function validateTimeRecordInput(input: TimeRecordValidationInput): void {
	if (!input.startAt.isValid) {
		throwValidationError("INVALID_START_TIME");
	}

	if (input.endAt && !input.endAt.isValid) {
		throwValidationError("INVALID_END_TIME");
	}

	if (input.durationMinutes !== null && input.durationMinutes !== undefined && !Number.isFinite(input.durationMinutes)) {
		throwValidationError("INVALID_DURATION");
	}

	if (input.durationMinutes !== null && input.durationMinutes !== undefined && input.durationMinutes < 0) {
		throwValidationError("NEGATIVE_DURATION");
	}

	if (input.endAt && input.endAt.toMillis() < input.startAt.toMillis()) {
		throwValidationError("INVALID_TIME_WINDOW");
	}

	if (input.recordKind === "break" && !input.endAt) {
		throwValidationError("BREAK_END_REQUIRED");
	}
}
