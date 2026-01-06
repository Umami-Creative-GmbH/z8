"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

export interface AuthContext {
	user: {
		id: string;
		email: string;
		name: string;
		image?: string;
	};
	session: {
		activeOrganizationId: string | null;
	};
	employee: {
		id: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
		teamId: string | null;
	} | null;
}

export interface UserOrganization {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	memberRole: string;
	hasEmployeeRecord: boolean;
}

/**
 * Get current authenticated user and their employee context
 * Uses activeOrganizationId from session to get the correct employee record
 */
export async function getAuthContext(): Promise<AuthContext | null> {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return null;
	}

	const activeOrganizationId = session.session?.activeOrganizationId || null;

	// Fetch employee record for the active organization
	let employeeRecord = null;

	if (activeOrganizationId) {
		[employeeRecord] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, activeOrganizationId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);
	} else {
		// If no active organization, get first employee record as fallback
		[employeeRecord] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);
	}

	return {
		user: {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
			image: session.user.image ?? undefined,
		},
		session: {
			activeOrganizationId,
		},
		employee: employeeRecord
			? {
					id: employeeRecord.id,
					organizationId: employeeRecord.organizationId,
					role: employeeRecord.role,
					teamId: employeeRecord.teamId,
				}
			: null,
	};
}

/**
 * Require authenticated user with employee context
 */
export async function requireAuth(): Promise<AuthContext> {
	const context = await getAuthContext();

	if (!context || !context.employee) {
		throw new Error("Authentication required");
	}

	return context;
}

/**
 * Require admin role
 */
export async function requireAdmin(): Promise<AuthContext> {
	const context = await requireAuth();

	if (context.employee?.role !== "admin") {
		throw new Error("Admin access required");
	}

	return context;
}

/**
 * Check if user has admin role (non-throwing)
 */
export async function isAdmin(): Promise<boolean> {
	const context = await getAuthContext();
	return context?.employee?.role === "admin";
}

/**
 * Check if user has manager role or higher (non-throwing)
 */
export async function isManagerOrAbove(): Promise<boolean> {
	const context = await getAuthContext();
	return context?.employee?.role === "admin" || context?.employee?.role === "manager";
}

/**
 * Get all organizations the current user is a member of
 */
export async function getUserOrganizations(): Promise<UserOrganization[]> {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return [];
	}

	// Get all organizations user is a member of
	const memberships = await db
		.select({
			organization: organization,
			member: member,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(eq(member.userId, session.user.id));

	// For each organization, check if user has an employee record
	const orgsWithEmployeeStatus = await Promise.all(
		memberships.map(async ({ organization: org, member: mbr }) => {
			const [employeeRecord] = await db
				.select()
				.from(employee)
				.where(
					and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, org.id),
						eq(employee.isActive, true),
					),
				)
				.limit(1);

			return {
				id: org.id,
				name: org.name,
				slug: org.slug,
				logo: org.logo,
				memberRole: mbr.role,
				hasEmployeeRecord: !!employeeRecord,
			};
		}),
	);

	return orgsWithEmployeeStatus;
}
