import { Temporal } from "temporal-polyfill";

export function payrollUtcTime(value: string): string {
	return `${Temporal.Instant.from(value).toZonedDateTimeISO("UTC").toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ")} UTC`;
}
