import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
	type Instant,
	type PlainDate,
	type PlainTime,
	parseInstant,
	parsePlainDate,
	parsePlainTimeMinute,
} from "./temporal-core";

const INSTANT_WIRE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d\.\d{3}Z$/;
const NANOSECONDS_PER_MILLISECOND = BigInt(1_000_000);

export const instantWireSchema = z
	.string()
	.regex(INSTANT_WIRE, "Instant must use YYYY-MM-DDTHH:mm:ss.SSSZ")
	.refine(
		(value) => {
			try {
				parseInstant(value);
				return true;
			} catch {
				return false;
			}
		},
		{ message: "Instant must be a valid UTC date-time" },
	);

export function serializeInstant(value: Instant): string {
	if (value.epochNanoseconds % NANOSECONDS_PER_MILLISECOND !== BigInt(0)) {
		throw new RangeError("Instant contains precision below milliseconds");
	}

	return instantWireSchema.parse(value.toString({ fractionalSecondDigits: 3 }));
}

export function deserializeInstant(value: string): Instant {
	return parseInstant(instantWireSchema.parse(value));
}

export function serializePlainDate(value: PlainDate): string {
	const serialized = value.toString();
	parsePlainDate(serialized);
	return serialized;
}

export function deserializePlainDate(value: string): PlainDate {
	return parsePlainDate(value);
}

export function serializePlainTimeMinute(value: PlainTime): string {
	if (
		value.second !== 0 ||
		value.millisecond !== 0 ||
		value.microsecond !== 0 ||
		value.nanosecond !== 0
	) {
		throw new RangeError("Plain time contains precision below minutes");
	}

	const serialized = `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
	parsePlainTimeMinute(serialized);
	return serialized;
}

export function deserializePlainTimeMinute(value: string): PlainTime {
	return parsePlainTimeMinute(value);
}

const temporalConstructors = [
	["Temporal.Duration", Temporal.Duration],
	["Temporal.Instant", Temporal.Instant],
	["Temporal.PlainDate", Temporal.PlainDate],
	["Temporal.PlainDateTime", Temporal.PlainDateTime],
	["Temporal.PlainMonthDay", Temporal.PlainMonthDay],
	["Temporal.PlainTime", Temporal.PlainTime],
	["Temporal.PlainYearMonth", Temporal.PlainYearMonth],
	["Temporal.ZonedDateTime", Temporal.ZonedDateTime],
] as const;

function temporalType(value: object): string | undefined {
	return temporalConstructors.find(([, Constructor]) => value instanceof Constructor)?.[0];
}

function rejectPayloadValue(path: string, type: string): never {
	throw new TypeError(`Invalid date-time payload at ${path}: ${type} is not JSON-safe`);
}

function propertyPath(path: string, property: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(property)
		? `${path}.${property}`
		: `${path}[${JSON.stringify(property)}]`;
}

export function assertPrimitiveDateTimePayload(payload: unknown): void {
	const active = new WeakSet<object>();

	const visit = (value: unknown, path: string): void => {
		if (value === undefined) {
			rejectPayloadValue(path, "undefined");
		}

		const valueType = typeof value;
		if (valueType === "bigint" || valueType === "symbol" || valueType === "function") {
			rejectPayloadValue(path, valueType);
		}
		if (valueType === "number" && !Number.isFinite(value)) {
			const numberType = Number.isNaN(value) ? "number (NaN)" : `number (${String(value)})`;
			rejectPayloadValue(path, numberType);
		}
		if (value === null || valueType !== "object") {
			return;
		}
		if (value instanceof Date) {
			rejectPayloadValue(path, "Date");
		}

		const temporalValueType = temporalType(value);
		if (temporalValueType) {
			rejectPayloadValue(path, temporalValueType);
		}
		if (active.has(value)) {
			rejectPayloadValue(path, "cycle");
		}

		const toJsonDescriptor = Object.getOwnPropertyDescriptor(value, "toJSON");
		if (
			toJsonDescriptor &&
			(typeof toJsonDescriptor.value === "function" || toJsonDescriptor.get !== undefined)
		) {
			rejectPayloadValue(propertyPath(path, "toJSON"), "toJSON serialization hook");
		}

		const symbolProperties = Object.getOwnPropertySymbols(value);
		if (symbolProperties.length > 0) {
			const symbolPath = `${path}[${String(symbolProperties[0])}]`;
			rejectPayloadValue(symbolPath, "symbol-keyed property");
		}

		if (!Array.isArray(value)) {
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) {
				const constructorName = value.constructor?.name ?? "unknown";
				rejectPayloadValue(path, `object (${constructorName})`);
			}
		}

		active.add(value);
		try {
			if (Array.isArray(value)) {
				for (let index = 0; index < value.length; index += 1) {
					visit(value[index], `${path}[${index}]`);
				}
				return;
			}

			for (const [property, nestedValue] of Object.entries(value)) {
				visit(nestedValue, propertyPath(path, property));
			}
		} finally {
			active.delete(value);
		}
	};

	visit(payload, "$");
}
