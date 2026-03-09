import type { Effect } from "effect";
import type { db } from "@/db";
import type { AnyAppError } from "@/lib/effect/errors";

export interface ApprovalWithAbsence {
	id: string;
	entityId: string;
	entityType: string;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	requester: {
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
	absence: {
		id: string;
		startDate: string;
		startPeriod: "full_day" | "am" | "pm";
		endDate: string;
		endPeriod: "full_day" | "am" | "pm";
		notes: string | null;
		category: {
			name: string;
			type: string;
			color: string | null;
		};
	};
}

export interface ApprovalWithTimeCorrection {
	id: string;
	entityId: string;
	entityType: string;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	requester: {
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
	workPeriod: {
		id: string;
		startTime: Date;
		endTime: Date | null;
		clockInEntry: {
			timestamp: Date;
		};
		clockOutEntry: {
			timestamp: Date;
		} | null;
	};
}

export type ApprovalEntityType = "absence_entry" | "time_entry";
export type ApprovalAction = "approve" | "reject";

export interface CurrentApprover {
	id: string;
	userId: string;
	organizationId: string;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
}

export interface PendingApprovalRequest {
	id: string;
	entityId: string;
	entityType: ApprovalEntityType;
	approverId: string;
	status: "pending" | "approved" | "rejected";
	approvedAt: Date | null;
	rejectionReason: string | null;
	updatedAt: Date;
}

export interface ApprovalStatusUpdate {
	status: "approved" | "rejected";
	approvedAt?: ReturnType<typeof import("@/lib/datetime/drizzle-adapter").currentTimestamp>;
	rejectionReason?: string;
	updatedAt: ReturnType<typeof import("@/lib/datetime/drizzle-adapter").currentTimestamp>;
}

export interface ApprovalDbService {
	db: typeof db;
	query: <T>(name: string, fn: () => Promise<T>) => Effect.Effect<T, AnyAppError, never>;
}
