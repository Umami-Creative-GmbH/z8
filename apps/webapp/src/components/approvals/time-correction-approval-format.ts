import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatCapturedOffsetInstant,
	formatInstant,
} from "@/lib/datetime/temporal-format";

export function formatCorrectionApprovalInstant(date: Date, context: DisplayContext): string {
	return formatInstant(instantFromDate(date), context, "time");
}

export function formatCorrectionApprovalDate(date: Date, context: DisplayContext): string {
	return formatInstant(instantFromDate(date), context, "dateMedium");
}

export function formatCorrectionAuditEndpoint(
	date: Date,
	offsetMinutes: number,
	context: DisplayContext,
): string {
	return formatCapturedOffsetInstant(instantFromDate(date), {
		locale: context.locale,
		timeFormat: context.timeFormat,
		offsetMinutes,
		preset: "time",
	});
}
