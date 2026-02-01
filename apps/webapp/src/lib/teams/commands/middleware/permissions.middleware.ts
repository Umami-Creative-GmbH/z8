/**
 * Permissions Middleware for Teams Bot Commands
 *
 * Checks manager/admin permissions before allowing command execution.
 * Integrates with existing employee and employeeManagers tables.
 */

import { eq, and, count } from "drizzle-orm";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { BotCommandContext, BotCommandResponse } from "../../types";

const logger = createLogger("TeamsPermissions");

// ============================================
// TYPES
// ============================================

export type RequiredRole = "manager" | "admin" | "any";

export interface PermissionCheckResult {
	allowed: boolean;
	role: string | null;
	isManager: boolean;
	managedEmployeeCount: number;
	errorMessage?: string;
}

// ============================================
// PERMISSION CHECKS
// ============================================

/**
 * Check if user has required permissions
 */
export async function checkPermissions(
	ctx: BotCommandContext,
	requiredRole: RequiredRole,
): Promise<PermissionCheckResult> {
	try {
		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.id, ctx.employeeId),
				eq(employee.organizationId, ctx.organizationId),
			),
			columns: {
				id: true,
				role: true,
			},
		});

		if (!emp) {
			return {
				allowed: false,
				role: null,
				isManager: false,
				managedEmployeeCount: 0,
				errorMessage: "Your employee record could not be found.",
			};
		}

		// Count managed employees in the SAME organization using a database-level join
		// This filters at the DB level for better security and performance
		const [managedCount] = await db
			.select({ count: count() })
			.from(employeeManagers)
			.innerJoin(employee, eq(employeeManagers.employeeId, employee.id))
			.where(
				and(
					eq(employeeManagers.managerId, emp.id),
					eq(employee.organizationId, ctx.organizationId),
				),
			);

		const managedEmployeeCount = Number(managedCount?.count) || 0;
		const isManager = managedEmployeeCount > 0;

		// Admin role bypasses all checks
		// Type cast needed because drizzle enum type inference can be narrow
		const empRole = emp.role as "admin" | "manager" | "employee";
		if (empRole === "admin") {
			return {
				allowed: true,
				role: "admin",
				isManager: true,
				managedEmployeeCount,
			};
		}

		// Check role requirements
		// Note: empRole can't be "admin" at this point (already returned above)
		if (requiredRole === "admin") {
			return {
				allowed: false,
				role: empRole,
				isManager,
				managedEmployeeCount,
				errorMessage: "This command is only available to organization admins.",
			};
		}

		if (requiredRole === "manager" && !isManager) {
			return {
				allowed: false,
				role: empRole,
				isManager: false,
				managedEmployeeCount: 0,
				errorMessage: "This command is only available to managers and admins.",
			};
		}

		return {
			allowed: true,
			role: empRole,
			isManager,
			managedEmployeeCount,
		};
	} catch (error) {
		logger.error({ error, userId: ctx.userId }, "Permission check failed");
		return {
			allowed: false,
			role: null,
			isManager: false,
			managedEmployeeCount: 0,
			errorMessage: "Failed to verify permissions. Please try again.",
		};
	}
}

/**
 * Get managed employee IDs for the current user
 * Uses database-level join filtering for security and performance
 */
export async function getManagedEmployeeIds(ctx: BotCommandContext): Promise<string[]> {
	try {
		// Use join to filter at database level - only returns employees in the same organization
		const managed = await db
			.select({ employeeId: employeeManagers.employeeId })
			.from(employeeManagers)
			.innerJoin(employee, eq(employeeManagers.employeeId, employee.id))
			.where(
				and(
					eq(employeeManagers.managerId, ctx.employeeId),
					eq(employee.organizationId, ctx.organizationId),
				),
			);

		return managed.map((m) => m.employeeId);
	} catch (error) {
		logger.error({ error, userId: ctx.userId }, "Failed to get managed employees");
		return [];
	}
}

/**
 * Higher-order function that wraps a command handler with permission checks
 */
export function withPermission(
	requiredRole: RequiredRole,
	handler: (ctx: BotCommandContext) => Promise<BotCommandResponse>,
): (ctx: BotCommandContext) => Promise<BotCommandResponse> {
	return async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		const result = await checkPermissions(ctx, requiredRole);

		if (!result.allowed) {
			return {
				type: "text",
				text: `⛔ ${result.errorMessage || "You don't have permission to use this command."}`,
			};
		}

		return handler(ctx);
	};
}

/**
 * Compose multiple middleware functions
 */
export function compose(
	...middlewares: Array<
		(
			handler: (ctx: BotCommandContext) => Promise<BotCommandResponse>,
		) => (ctx: BotCommandContext) => Promise<BotCommandResponse>
	>
): (
	handler: (ctx: BotCommandContext) => Promise<BotCommandResponse>,
) => (ctx: BotCommandContext) => Promise<BotCommandResponse> {
	return (handler) => {
		return middlewares.reduceRight((acc, middleware) => middleware(acc), handler);
	};
}
