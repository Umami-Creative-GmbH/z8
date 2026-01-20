import type { shift, shiftRecurrence, shiftRequest, shiftTemplate } from "@/db/schema";

export type Shift = typeof shift.$inferSelect;
export type ShiftTemplate = typeof shiftTemplate.$inferSelect;
export type ShiftRequest = typeof shiftRequest.$inferSelect;
export type ShiftRecurrence = typeof shiftRecurrence.$inferSelect;
export type ShiftStatus = "draft" | "published";
export type ShiftRequestType = "swap" | "assignment" | "pickup";
export type ShiftRecurrenceType = "daily" | "weekly" | "biweekly" | "monthly" | "custom";

export interface DateRange {
	start: Date;
	end: Date;
}

export interface SubareaInfo {
	id: string;
	name: string;
	location: {
		id: string;
		name: string;
	};
}

export interface ShiftWithRelations extends Shift {
	employee?: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	template?: ShiftTemplate | null;
	subarea?: SubareaInfo | null;
	recurrence?: ShiftRecurrence | null;
}

export interface ShiftRequestWithRelations extends ShiftRequest {
	shift: Shift & {
		employee?: {
			id: string;
			firstName: string | null;
			lastName: string | null;
		} | null;
	};
	requester: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	};
	targetEmployee?: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

export interface ShiftMetadata {
	hasOverlap: boolean;
	overlappingShifts: Array<{
		id: string;
		date: Date;
		startTime: string;
		endTime: string;
	}>;
}

export interface IncompleteDayInfo {
	date: Date;
	openShiftCount: number;
}

export interface CreateTemplateInput {
	name: string;
	startTime: string;
	endTime: string;
	color?: string;
	subareaId?: string; // Optional default subarea for shifts using this template
}

export interface UpdateTemplateInput {
	name?: string;
	startTime?: string;
	endTime?: string;
	color?: string;
	isActive?: boolean;
	subareaId?: string | null;
}

export interface UpsertShiftInput {
	id?: string;
	employeeId?: string | null;
	templateId?: string | null;
	subareaId: string; // Required - every shift must be assigned to a subarea
	date: Date;
	startTime: string;
	endTime: string;
	notes?: string;
	color?: string;
}

export interface ShiftQuery {
	startDate?: Date;
	endDate?: Date;
	employeeId?: string;
	subareaId?: string; // Filter by subarea
	status?: ShiftStatus;
	includeOpenShifts?: boolean;
}

export interface SwapRequestInput {
	shiftId: string;
	targetEmployeeId?: string;
	reason?: string;
	reasonCategory?: string;
	notes?: string;
}
