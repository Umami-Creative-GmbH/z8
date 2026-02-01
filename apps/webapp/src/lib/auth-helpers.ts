"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { ManagerService, ManagerServiceLive } from "@/lib/effect/services/manager.service";
import { detectAppType, type AppPermissions } from "@/lib/effect/services/app-access.service";
import type { AppType } from "@/lib/audit-logger";

export interface AuthContext {
	user: {
		id: string;
		email: string;
		name: string;
		image?: string;
		role?: string;
		canCreateOrganizations: boolean;
		// App access permissions
		canUseWebapp: boolean;
		canUseDesktop: boolean;
		canUseMobile: boolean;
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
	projectsEnabled: boolean;
}

/**
 * Get current authenticated user and their employee context
 * Uses activeOrganizationId from session to get the correct employee record
 *
 * SECURITY: Only returns employee data for the active organization.
 * If no activeOrganizationId is set, employee will be null.
 * This prevents cross-organization data leakage.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return null;
	}

	const activeOrganizationId = session.session?.activeOrganizationId || null;

	// Fetch employee record for the active organization ONLY
	// SECURITY: We intentionally do NOT fall back to any employee record
	// if no activeOrganizationId is set. This ensures org-scoped data isolation.
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
	}
	// No fallback - if no active org, employee stays null

	return {
		user: {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
			image: session.user.image ?? undefined,
			role: session.user.role ?? undefined,
			canCreateOrganizations: session.user.canCreateOrganizations ?? false,
			// App access permissions - default to true for backward compatibility
			canUseWebapp: session.user.canUseWebapp ?? true,
			canUseDesktop: session.user.canUseDesktop ?? true,
			canUseMobile: session.user.canUseMobile ?? true,
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
 * Check if user is a platform/system admin (user.role === "admin")
 * This is different from org admin (employee.role === "admin")
 */
export async function isSystemAdmin(): Promise<boolean> {
	const context = await getAuthContext();
	return context?.user.role === "admin";
}

/**
 * Require platform/system admin role (throws if not)
 * Use this in server actions and API routes for platform-level operations
 */
export async function requireSystemAdmin(): Promise<AuthContext> {
	const context = await getAuthContext();

	if (!context) {
		throw new Error("Authentication required");
	}

	if (context.user.role !== "admin") {
		throw new Error("Platform admin access required");
	}

	return context;
}

/**
 * Get all organizations the current user is a member of
 * Optimized: Uses single batch query instead of N+1 pattern
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

	if (memberships.length === 0) {
		return [];
	}

	// Single batch query for all employee records (instead of N queries)
	const orgIds = memberships.map((m) => m.organization.id);
	const employeeRecords = await db
		.select({ organizationId: employee.organizationId })
		.from(employee)
		.where(
			and(
				eq(employee.userId, session.user.id),
				inArray(employee.organizationId, orgIds),
				eq(employee.isActive, true),
			),
		);

	// O(1) lookup with Set
	const orgsWithEmployee = new Set(employeeRecords.map((e) => e.organizationId));

	// Map without additional queries
	return memberships.map(({ organization: org, member: mbr }) => ({
		id: org.id,
		name: org.name,
		slug: org.slug,
		logo: org.logo,
		memberRole: mbr.role,
		hasEmployeeRecord: orgsWithEmployee.has(org.id),
		shiftsEnabled: org.shiftsEnabled ?? false,
		projectsEnabled: org.projectsEnabled ?? false,
	}));
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
		return yield* _(managerService.isManagerOf(context.employee!.id, targetEmployeeId));
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
 * Get current user's onboarding status from userSettings
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus | null> {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return null;
	}

	const [settingsData] = await db
		.select({
			onboardingComplete: userSettings.onboardingComplete,
			onboardingStep: userSettings.onboardingStep,
		})
		.from(userSettings)
		.where(eq(userSettings.userId, session.user.id))
		.limit(1);

	return {
		onboardingComplete: settingsData?.onboardingComplete ?? false,
		onboardingStep: settingsData?.onboardingStep ?? null,
	};
}

// ============================================
// ORGANIZATION MEMBERSHIP VERIFICATION
// ============================================

export interface OrgVerificationResult {
	isValid: boolean;
	userId: string;
	organizationId: string;
	employeeId: string | null;
	role: "admin" | "manager" | "employee" | null;
}

/**
 * Verify that the current user is a member of the specified organization.
 * This is the CRITICAL function for multi-tenant security.
 *
 * Use this in API routes when the organizationId comes from client input
 * (query params, request body, etc.) to prevent unauthorized access.
 *
 * @param requestedOrgId - The organization ID from client request
 * @returns OrgVerificationResult with isValid=false if user is not a member
 *
 * @example
 * ```typescript
 * const orgId = searchParams.get("organizationId");
 * const verification = await verifyOrgMembership(orgId);
 * if (!verification.isValid) {
 *   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 * }
 * // Safe to proceed with orgId
 * ```
 */
export async function verifyOrgMembership(
	requestedOrgId: string | null,
): Promise<OrgVerificationResult | null> {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return null;
	}

	if (!requestedOrgId) {
		return {
			isValid: false,
			userId: session.user.id,
			organizationId: "",
			employeeId: null,
			role: null,
		};
	}

	// Check if user is a member of the requested organization
	const [memberRecord] = await db
		.select({
			memberId: member.id,
			memberRole: member.role,
		})
		.from(member)
		.where(and(eq(member.userId, session.user.id), eq(member.organizationId, requestedOrgId)))
		.limit(1);

	if (!memberRecord) {
		return {
			isValid: false,
			userId: session.user.id,
			organizationId: requestedOrgId,
			employeeId: null,
			role: null,
		};
	}

	// Also get employee record if exists
	const [employeeRecord] = await db
		.select({
			id: employee.id,
			role: employee.role,
		})
		.from(employee)
		.where(
			and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, requestedOrgId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);

	return {
		isValid: true,
		userId: session.user.id,
		organizationId: requestedOrgId,
		employeeId: employeeRecord?.id ?? null,
		role: employeeRecord?.role ?? null,
	};
}

/**
 * Require organization membership - throws if user is not a member.
 * Use this in API routes for cleaner code flow.
 *
 * @param requestedOrgId - The organization ID from client request
 * @throws Error if user is not authenticated or not a member
 * @returns OrgVerificationResult with verified membership
 *
 * @example
 * ```typescript
 * try {
 *   const org = await requireOrgMembership(searchParams.get("organizationId"));
 *   // Safe to use org.organizationId
 * } catch (error) {
 *   return NextResponse.json({ error: error.message }, { status: 403 });
 * }
 * ```
 */
export async function requireOrgMembership(
	requestedOrgId: string | null,
): Promise<OrgVerificationResult> {
	const result = await verifyOrgMembership(requestedOrgId);

	if (!result) {
		throw new Error("Authentication required");
	}

	if (!result.isValid) {
		throw new Error("Access denied: You are not a member of this organization");
	}

	return result;
}

/**
 * Get verified organization context for API routes.
 * Combines session auth with org membership verification.
 *
 * This is the recommended function for API routes that accept organizationId
 * from the client. It ensures the user is both authenticated AND a member
 * of the requested organization.
 *
 * @param requestedOrgId - The organization ID from client request (query param, body, etc.)
 * @returns Full auth context with verified org membership, or null if invalid
 *
 * @example
 * ```typescript
 * const context = await getVerifiedOrgContext(searchParams.get("organizationId"));
 * if (!context) {
 *   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 * }
 * // Use context.organizationId - guaranteed to be authorized
 * ```
 */
export async function getVerifiedOrgContext(requestedOrgId: string | null): Promise<{
	user: AuthContext["user"];
	organizationId: string;
	employeeId: string | null;
	role: "admin" | "manager" | "employee" | null;
} | null> {
	const verification = await verifyOrgMembership(requestedOrgId);

	if (!verification || !verification.isValid) {
		return null;
	}

	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	return {
		user: {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
			image: session.user.image ?? undefined,
			role: session.user.role ?? undefined,
			canCreateOrganizations: session.user.canCreateOrganizations ?? false,
			canUseWebapp: session.user.canUseWebapp ?? true,
			canUseDesktop: session.user.canUseDesktop ?? true,
			canUseMobile: session.user.canUseMobile ?? true,
		},
		organizationId: verification.organizationId,
		employeeId: verification.employeeId,
		role: verification.role,
	};
}

// ============================================
// APP ACCESS VALIDATION
// ============================================

export interface AppAccessValidationResult {
	allowed: boolean;
	appType: AppType;
	reason?: string;
}

/**
 * Validate if the current user has access to the app type being used.
 * Detects app type from request headers (Bearer token = desktop/mobile, cookie = webapp).
 *
 * @param user - User object with app permissions
 * @param requestHeaders - Request headers for app type detection
 * @returns Validation result with allowed flag and reason if denied
 *
 * @example
 * ```typescript
 * const session = await auth.api.getSession({ headers: await headers() });
 * const accessCheck = await validateAppAccess(session.user, await headers());
 * if (!accessCheck.allowed) {
 *   redirect(`/access-denied?app=${accessCheck.appType}`);
 * }
 * ```
 */
export async function validateAppAccess(
	user: {
		canUseWebapp?: boolean | null;
		canUseDesktop?: boolean | null;
		canUseMobile?: boolean | null;
	},
	requestHeaders: Headers,
): Promise<AppAccessValidationResult> {
	const appType = detectAppType(requestHeaders);

	const canUseWebapp = user.canUseWebapp ?? true;
	const canUseDesktop = user.canUseDesktop ?? true;
	const canUseMobile = user.canUseMobile ?? true;

	let allowed = true;
	let reason: string | undefined;

	if (appType === "webapp" && !canUseWebapp) {
		allowed = false;
		reason =
			"Your account does not have access to the web application. Please contact your administrator.";
	} else if (appType === "desktop" && !canUseDesktop) {
		allowed = false;
		reason =
			"Your account does not have access to the desktop application. Please contact your administrator.";
	} else if (appType === "mobile" && !canUseMobile) {
		allowed = false;
		reason =
			"Your account does not have access to the mobile application. Please contact your administrator.";
	}

	return { allowed, appType, reason };
}

/**
 * Require app access - throws error if user doesn't have access to the current app type.
 * Use this in API routes and server actions for cleaner error handling.
 *
 * @param user - User object with app permissions
 * @param requestHeaders - Request headers for app type detection
 * @throws Error if user doesn't have access
 * @returns The detected app type if access is allowed
 */
export async function requireAppAccess(
	user: {
		canUseWebapp?: boolean | null;
		canUseDesktop?: boolean | null;
		canUseMobile?: boolean | null;
	},
	requestHeaders: Headers,
): Promise<AppType> {
	const result = await validateAppAccess(user, requestHeaders);

	if (!result.allowed) {
		throw new Error(result.reason || "Access denied");
	}

	return result.appType;
}
