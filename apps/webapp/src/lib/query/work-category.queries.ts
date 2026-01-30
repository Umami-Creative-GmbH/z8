/**
 * Work Category Queries
 *
 * Database query functions for work category sets, individual categories,
 * and hierarchical assignments (org/team/employee).
 *
 * Uses many-to-many relationship through workCategorySetCategory junction table.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	employee,
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
} from "@/db/schema";

// ============================================
// Types
// ============================================

export interface WorkCategorySetRecord {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
}

// Org-level category record (no setId, no sortOrder)
export interface WorkCategoryRecord {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	factor: string; // Stored as decimal in DB
	color: string | null;
	isActive: boolean;
	createdAt: Date;
}

// Category record when within a set (includes sortOrder from junction)
export interface SetCategoryRecord extends WorkCategoryRecord {
	sortOrder: number;
}

export interface WorkCategorySetAssignmentRecord {
	id: string;
	setId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
}

export interface ResolvedWorkCategorySet {
	set: WorkCategorySetRecord | null;
	source: "employee" | "team" | "organization" | "none";
	assignment: WorkCategorySetAssignmentRecord | null;
}

export interface WorkCategorySetWithCount extends WorkCategorySetRecord {
	categoryCount: number;
}

export interface AssignmentWithDetails extends WorkCategorySetAssignmentRecord {
	set: {
		id: string;
		name: string;
		description: string | null;
	};
	team: {
		id: string;
		name: string;
	} | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

// ============================================
// Category Set Queries
// ============================================

/**
 * Get all work category sets for an organization (with category count)
 */
export async function getWorkCategorySets(
	organizationId: string,
): Promise<WorkCategorySetWithCount[]> {
	const sets = await db
		.select()
		.from(workCategorySet)
		.where(
			and(eq(workCategorySet.organizationId, organizationId), eq(workCategorySet.isActive, true)),
		)
		.orderBy(asc(workCategorySet.name));

	// Get category count for each set through junction table
	const setsWithCounts = await Promise.all(
		sets.map(async (set) => {
			const [countResult] = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(workCategorySetCategory)
				.innerJoin(
					workCategory,
					and(
						eq(workCategorySetCategory.categoryId, workCategory.id),
						eq(workCategory.isActive, true),
					),
				)
				.where(eq(workCategorySetCategory.setId, set.id));

			return {
				...set,
				categoryCount: countResult?.count ?? 0,
			};
		}),
	);

	return setsWithCounts;
}

/**
 * Get a specific work category set by ID
 */
export async function getWorkCategorySetById(setId: string): Promise<WorkCategorySetRecord | null> {
	const result = await db.query.workCategorySet.findFirst({
		where: eq(workCategorySet.id, setId),
	});

	return result ?? null;
}

/**
 * Get a work category set with all its categories (through junction table)
 */
export async function getWorkCategorySetWithCategories(setId: string): Promise<{
	set: WorkCategorySetRecord;
	categories: SetCategoryRecord[];
} | null> {
	const set = await db.query.workCategorySet.findFirst({
		where: eq(workCategorySet.id, setId),
	});

	if (!set) return null;

	// Get categories through junction table
	const categories = await db
		.select({
			id: workCategory.id,
			organizationId: workCategory.organizationId,
			name: workCategory.name,
			description: workCategory.description,
			factor: workCategory.factor,
			color: workCategory.color,
			isActive: workCategory.isActive,
			createdAt: workCategory.createdAt,
			sortOrder: workCategorySetCategory.sortOrder,
		})
		.from(workCategorySetCategory)
		.innerJoin(workCategory, eq(workCategorySetCategory.categoryId, workCategory.id))
		.where(and(eq(workCategorySetCategory.setId, setId), eq(workCategory.isActive, true)))
		.orderBy(asc(workCategorySetCategory.sortOrder), asc(workCategory.name));

	return {
		set,
		categories,
	};
}

// ============================================
// Category Queries
// ============================================

/**
 * Get all categories for an organization (org-level)
 */
export async function getOrganizationCategories(
	organizationId: string,
): Promise<WorkCategoryRecord[]> {
	return db
		.select({
			id: workCategory.id,
			organizationId: workCategory.organizationId,
			name: workCategory.name,
			description: workCategory.description,
			factor: workCategory.factor,
			color: workCategory.color,
			isActive: workCategory.isActive,
			createdAt: workCategory.createdAt,
		})
		.from(workCategory)
		.where(and(eq(workCategory.organizationId, organizationId), eq(workCategory.isActive, true)))
		.orderBy(asc(workCategory.name));
}

/**
 * Get all categories in a set (through junction table)
 */
export async function getCategoriesInSet(setId: string): Promise<SetCategoryRecord[]> {
	return db
		.select({
			id: workCategory.id,
			organizationId: workCategory.organizationId,
			name: workCategory.name,
			description: workCategory.description,
			factor: workCategory.factor,
			color: workCategory.color,
			isActive: workCategory.isActive,
			createdAt: workCategory.createdAt,
			sortOrder: workCategorySetCategory.sortOrder,
		})
		.from(workCategorySetCategory)
		.innerJoin(workCategory, eq(workCategorySetCategory.categoryId, workCategory.id))
		.where(and(eq(workCategorySetCategory.setId, setId), eq(workCategory.isActive, true)))
		.orderBy(asc(workCategorySetCategory.sortOrder), asc(workCategory.name));
}

/**
 * Get a specific category by ID
 */
export async function getWorkCategoryById(categoryId: string): Promise<WorkCategoryRecord | null> {
	const [result] = await db
		.select({
			id: workCategory.id,
			organizationId: workCategory.organizationId,
			name: workCategory.name,
			description: workCategory.description,
			factor: workCategory.factor,
			color: workCategory.color,
			isActive: workCategory.isActive,
			createdAt: workCategory.createdAt,
		})
		.from(workCategory)
		.where(eq(workCategory.id, categoryId))
		.limit(1);

	return result ?? null;
}

// ============================================
// Assignment Queries
// ============================================

/**
 * Get all assignments for an organization
 */
export async function getWorkCategorySetAssignments(
	organizationId: string,
): Promise<AssignmentWithDetails[]> {
	const assignments = await db.query.workCategorySetAssignment.findMany({
		where: and(
			eq(workCategorySetAssignment.organizationId, organizationId),
			eq(workCategorySetAssignment.isActive, true),
		),
		with: {
			set: true,
			team: true,
			employee: true,
		},
		orderBy: [
			asc(workCategorySetAssignment.assignmentType),
			desc(workCategorySetAssignment.createdAt),
		],
	});

	return assignments.map((a) => ({
		id: a.id,
		setId: a.setId,
		organizationId: a.organizationId,
		assignmentType: a.assignmentType,
		teamId: a.teamId,
		employeeId: a.employeeId,
		priority: a.priority,
		effectiveFrom: a.effectiveFrom,
		effectiveUntil: a.effectiveUntil,
		isActive: a.isActive,
		createdAt: a.createdAt,
		createdBy: a.createdBy,
		updatedAt: a.updatedAt,
		set: {
			id: a.set.id,
			name: a.set.name,
			description: a.set.description,
		},
		team: a.team
			? {
					id: a.team.id,
					name: a.team.name,
				}
			: null,
		employee: a.employee
			? {
					id: a.employee.id,
					firstName: a.employee.firstName,
					lastName: a.employee.lastName,
				}
			: null,
	}));
}

/**
 * Resolve effective work category set for an employee using hierarchy:
 * Employee assignment > Team assignment > Organization default
 */
export async function getEffectiveWorkCategorySetForEmployee(
	employeeId: string,
): Promise<ResolvedWorkCategorySet> {
	// Get employee with their team info
	const employeeRecord = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		columns: {
			id: true,
			organizationId: true,
			teamId: true,
		},
	});

	if (!employeeRecord) {
		return { set: null, source: "none", assignment: null };
	}

	const now = new Date();

	// Helper function to check date constraints
	const isEffective = (effectiveFrom: Date | null, effectiveUntil: Date | null) => {
		const fromOk = !effectiveFrom || effectiveFrom <= now;
		const untilOk = !effectiveUntil || effectiveUntil >= now;
		return fromOk && untilOk;
	};

	// 1. Check for employee-specific assignment (priority 2)
	const employeeAssignment = await db.query.workCategorySetAssignment.findFirst({
		where: and(
			eq(workCategorySetAssignment.employeeId, employeeId),
			eq(workCategorySetAssignment.assignmentType, "employee"),
			eq(workCategorySetAssignment.isActive, true),
		),
		with: {
			set: true,
		},
	});

	if (
		employeeAssignment?.set?.isActive &&
		isEffective(employeeAssignment.effectiveFrom, employeeAssignment.effectiveUntil)
	) {
		return {
			set: employeeAssignment.set,
			source: "employee",
			assignment: employeeAssignment,
		};
	}

	// 2. Check for team assignment (priority 1) if employee has a team
	if (employeeRecord.teamId) {
		const teamAssignment = await db.query.workCategorySetAssignment.findFirst({
			where: and(
				eq(workCategorySetAssignment.teamId, employeeRecord.teamId),
				eq(workCategorySetAssignment.assignmentType, "team"),
				eq(workCategorySetAssignment.isActive, true),
			),
			with: {
				set: true,
			},
		});

		if (
			teamAssignment?.set?.isActive &&
			isEffective(teamAssignment.effectiveFrom, teamAssignment.effectiveUntil)
		) {
			return {
				set: teamAssignment.set,
				source: "team",
				assignment: teamAssignment,
			};
		}
	}

	// 3. Check for organization default (priority 0)
	const orgAssignment = await db.query.workCategorySetAssignment.findFirst({
		where: and(
			eq(workCategorySetAssignment.organizationId, employeeRecord.organizationId),
			eq(workCategorySetAssignment.assignmentType, "organization"),
			eq(workCategorySetAssignment.isActive, true),
		),
		with: {
			set: true,
		},
	});

	if (
		orgAssignment?.set?.isActive &&
		isEffective(orgAssignment.effectiveFrom, orgAssignment.effectiveUntil)
	) {
		return {
			set: orgAssignment.set,
			source: "organization",
			assignment: orgAssignment,
		};
	}

	return { set: null, source: "none", assignment: null };
}

/**
 * Get available categories for an employee (resolves hierarchy and returns categories)
 */
export async function getAvailableCategoriesForEmployee(
	employeeId: string,
): Promise<SetCategoryRecord[]> {
	const { set } = await getEffectiveWorkCategorySetForEmployee(employeeId);

	if (!set) {
		return [];
	}

	return getCategoriesInSet(set.id);
}

/**
 * Check if an employee has access to a specific category
 */
export async function employeeHasAccessToCategory(
	employeeId: string,
	categoryId: string,
): Promise<boolean> {
	const availableCategories = await getAvailableCategoriesForEmployee(employeeId);
	return availableCategories.some((c) => c.id === categoryId);
}
