/**
 * Client-side checks of the shift template form. They mirror what the server enforces and no
 * more: ShiftService accepts only HH:mm (24h) start and end times — an end before the start is an
 * overnight shift, not an error — and createShiftTemplate/updateShiftTemplate refuse a scoped
 * manager's template without one of their subareas (canManageScopedSchedulingSubarea).
 */

/** The server's time format (ShiftService.isValidTimeFormat). */
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ShiftTemplateFieldError = "invalidTime" | "subareaRequired";

export function shiftTemplateTimeError(value: string): ShiftTemplateFieldError | undefined {
	return TIME_FORMAT.test(value) ? undefined : "invalidTime";
}

export function shiftTemplateSubareaError(
	subareaId: string,
	requireScopedSubareaSelection: boolean,
): ShiftTemplateFieldError | undefined {
	return requireScopedSubareaSelection && !subareaId ? "subareaRequired" : undefined;
}
