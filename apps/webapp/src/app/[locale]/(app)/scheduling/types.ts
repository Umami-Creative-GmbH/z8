import type { shift, shiftRequest, shiftTemplate } from "@/db/schema";

export type Shift = typeof shift.$inferSelect;
export type ShiftTemplate = typeof shiftTemplate.$inferSelect;
export type ShiftRequest = typeof shiftRequest.$inferSelect;
export type ShiftStatus = "draft" | "published";
export type ShiftRequestType = "swap" | "assignment" | "pickup";

export interface DateRange {
	start: Date;
	end: Date;
}

export interface ShiftWithRelations extends Shift {
	employee?: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	template?: ShiftTemplate | null;
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
}

export interface UpdateTemplateInput {
	name?: string;
	startTime?: string;
	endTime?: string;
	color?: string;
	isActive?: boolean;
}

export interface UpsertShiftInput {
	id?: string;
	employeeId?: string | null;
	templateId?: string | null;
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
