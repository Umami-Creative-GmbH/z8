import { user } from "@/db/auth-schema";
import { employee, type team } from "@/db/schema";

export type EmployeeRole = typeof employee.$inferSelect["role"];

export type EmployeeWithRelations = typeof employee.$inferSelect & {
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
};

export interface EmployeeListParams {
	search?: string;
	role?: EmployeeRole | "all";
	status?: "active" | "inactive" | "all";
	limit?: number;
	offset?: number;
}

export interface PaginatedEmployeeResponse {
	employees: EmployeeWithRelations[];
	total: number;
	hasMore: boolean;
}

export interface SelectableEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
	role: EmployeeRole;
	isActive: boolean;
	teamId: string | null;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
	team: {
		id: string;
		name: string;
	} | null;
}

export interface EmployeeSelectParams {
	search?: string;
	role?: EmployeeRole | "all";
	roles?: EmployeeRole[];
	status?: "active" | "inactive" | "all";
	teamId?: string;
	excludeIds?: string[];
	limit?: number;
	offset?: number;
	managerId?: string;
}

export interface EmployeeSelectResponse {
	employees: SelectableEmployee[];
	total: number;
	hasMore: boolean;
}
