"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { ManagerService, ManagerServiceLive } from "@/lib/effect/services/manager.service";

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
	shiftsEnabled: boolean;
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
 * Require authenticated user (without requiring employee context)
 */
export async function requireUser(): Promise<AuthContext> {
	const context = await getAuthContext();

	if (!context) {
		throw new Error("Authentication required");
	}

	return context;
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
				shiftsEnabled: org.shiftsEnabled ?? false,
			};
		}),
	);

	return orgsWithEmployeeStatus;
}

/**
 * Check if current employee is a manager of the specified employee
 * Uses the ManagerService to check the many-to-many manager relationship
 */
export async function isManagerOf(targetEmployeeId: string): Promise<boolean> {
	const context = await getAuthContext();

	if (!context?.employee) {
		return false;
	}

	// Admins have manager privileges for all employees in their organization
	if (context.employee.role === "admin") {
		return true;
	}

	// Check manager relationship using ManagerService
	const effect = Effect.gen(function* (_) {
		const managerService = yield* _(ManagerService);
		return yield* _(managerService.isManagerOf(context.employee?.id, targetEmployeeId));
	});

	try {
		return await Effect.runPromise(
			effect.pipe(Effect.provide(ManagerServiceLive), Effect.provide(DatabaseServiceLive)),
		);
	} catch (_error) {
		// If there's an error checking the relationship, return false
		return false;
	}
}

/**
 * Check if current employee can approve requests for the specified employee
 * This combines admin role check with manager relationship check
 */
export async function canApproveFor(targetEmployeeId: string): Promise<boolean> {
	const context = await getAuthContext();

	if (!context?.employee) {
		return false;
	}

	// Admins can approve for anyone in their organization
	if (context.employee.role === "admin") {
		return true;
	}

	// Check if current employee is a manager of the target employee
	return await isManagerOf(targetEmployeeId);
}

export interface OnboardingStatus {
	onboardingComplete: boolean;
	onboardingStep: string | null;
}

/**
 * Get current user's onboarding status
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus | null> {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return null;
	}

	const [userData] = await db
		.select({
			onboardingComplete: user.onboardingComplete,
			onboardingStep: user.onboardingStep,
		})
		.from(user)
		.where(eq(user.id, session.user.id))
		.limit(1);

	if (!userData) {
		return null;
	}

	return {
		onboardingComplete: userData.onboardingComplete,
		onboardingStep: userData.onboardingStep,
	};
}
