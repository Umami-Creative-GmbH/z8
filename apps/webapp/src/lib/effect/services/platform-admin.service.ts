import { Context, Effect, Layer } from "effect";
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { user, session, organization, member } from "@/db/auth-schema";
import { employee, platformAdminAuditLog, organizationSuspension } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
} from "../errors";

// Types
export interface PlatformUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	role: string | null;
	banned: boolean | null;
	banReason: string | null;
	banExpires: Date | null;
	createdAt: Date;
	image: string | null;
}

export interface PlatformUserFilters {
	search?: string;
	status?: "all" | "active" | "banned";
}

export interface PlatformOrganization {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	createdAt: Date;
	employeeCount: number;
	memberCount: number;
	isSuspended: boolean;
	suspendedReason: string | null;
	deletedAt: Date | null;
}

export interface PlatformOrgFilters {
	search?: string;
	status?: "all" | "active" | "suspended" | "deleted";
}

export interface Pagination {
	page: number;
	pageSize: number;
}

export interface PaginatedResult<T> {
	data: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface UserSession {
	id: string;
	token: string;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: Date;
	expiresAt: Date;
	activeOrganizationId: string | null;
	impersonatedBy: string | null;
}

export interface AuditLogEntry {
	action: string;
	targetType: string;
	targetId: string;
	metadata: string | null;
	ipAddress: string | null;
	createdAt: Date;
}

// Service interface
export class PlatformAdminService extends Context.Tag("PlatformAdminService")<
	PlatformAdminService,
	{
		// Authorization
		readonly requirePlatformAdmin: () => Effect.Effect<
			{ userId: string; email: string },
			AuthorizationError
		>;

		// User Management
		readonly listUsers: (
			filters: PlatformUserFilters,
			pagination: Pagination,
		) => Effect.Effect<PaginatedResult<PlatformUser>, DatabaseError>;

		readonly banUser: (
			userId: string,
			reason: string,
			expiresAt: Date | null,
			adminId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly unbanUser: (
			userId: string,
			adminId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		// Session Management
		readonly listUserSessions: (
			userId: string,
		) => Effect.Effect<UserSession[], DatabaseError>;

		readonly revokeSession: (
			sessionId: string,
			adminId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly revokeAllUserSessions: (
			userId: string,
			adminId: string,
		) => Effect.Effect<number, DatabaseError>;

		// Organization Management
		readonly listOrganizations: (
			filters: PlatformOrgFilters,
			pagination: Pagination,
		) => Effect.Effect<PaginatedResult<PlatformOrganization>, DatabaseError>;

		readonly suspendOrganization: (
			orgId: string,
			reason: string,
			adminId: string,
		) => Effect.Effect<void, NotFoundError | ConflictError | DatabaseError>;

		readonly unsuspendOrganization: (
			orgId: string,
			adminId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly deleteOrganization: (
			orgId: string,
			immediate: boolean,
			skipNotification: boolean,
			adminId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly isOrganizationSuspended: (
			orgId: string,
		) => Effect.Effect<boolean, DatabaseError>;

		// Audit
		readonly logAction: (
			adminId: string,
			action: string,
			targetType: string,
			targetId: string,
			metadata?: Record<string, unknown>,
		) => Effect.Effect<void, DatabaseError>;

		readonly getRecentAuditLogs: (
			limit?: number,
		) => Effect.Effect<AuditLogEntry[], DatabaseError>;
	}
>() {}

// Service implementation
export const PlatformAdminServiceLive = Layer.effect(
	PlatformAdminService,
	Effect.sync(() =>
		PlatformAdminService.of({
			requirePlatformAdmin: () =>
				Effect.tryPromise({
					try: async () => {
						const sessionData = await auth.api.getSession({
							headers: await headers(),
						});

						if (!sessionData?.user) {
							throw new Error("Not authenticated");
						}

						if (sessionData.user.role !== "admin") {
							throw new Error("Not a platform admin");
						}

						// Check if admin is banned
						if (sessionData.user.banned) {
							throw new Error("Account is banned");
						}

						return {
							userId: sessionData.user.id,
							email: sessionData.user.email,
						};
					},
					catch: () =>
						new AuthorizationError({
							message: "Platform admin access required",
							resource: "platform_admin",
							action: "access",
						}),
				}),

			listUsers: (filters, pagination) =>
				Effect.tryPromise({
					try: async () => {
						const { search, status } = filters;
						const { page, pageSize } = pagination;
						const offset = (page - 1) * pageSize;

						// Build where conditions
						const conditions = [];

						if (search) {
							conditions.push(
								or(
									ilike(user.name, `%${search}%`),
									ilike(user.email, `%${search}%`),
								),
							);
						}

						if (status === "active") {
							conditions.push(
								or(eq(user.banned, false), isNull(user.banned)),
							);
						} else if (status === "banned") {
							conditions.push(eq(user.banned, true));
						}

						const whereClause =
							conditions.length > 0 ? and(...conditions) : undefined;

						// Get total count
						const [{ total }] = await db
							.select({ total: count() })
							.from(user)
							.where(whereClause);

						// Get paginated users
						const users = await db
							.select({
								id: user.id,
								name: user.name,
								email: user.email,
								emailVerified: user.emailVerified,
								role: user.role,
								banned: user.banned,
								banReason: user.banReason,
								banExpires: user.banExpires,
								createdAt: user.createdAt,
								image: user.image,
							})
							.from(user)
							.where(whereClause)
							.orderBy(desc(user.createdAt))
							.limit(pageSize)
							.offset(offset);

						return {
							data: users,
							total,
							page,
							pageSize,
							totalPages: Math.ceil(total / pageSize),
						};
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to list users",
							operation: "listUsers",
							cause: error,
						}),
				}),

			banUser: (userId, reason, expiresAt, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Check if user exists
						const [existingUser] = await db
							.select({ id: user.id })
							.from(user)
							.where(eq(user.id, userId))
							.limit(1);

						if (!existingUser) {
							throw { type: "not_found" };
						}

						// Update user ban status
						await db
							.update(user)
							.set({
								banned: true,
								banReason: reason,
								banExpires: expiresAt,
							})
							.where(eq(user.id, userId));

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "ban_user",
							targetType: "user",
							targetId: userId,
							metadata: JSON.stringify({ reason, expiresAt }),
						});
					},
					catch: (error) => {
						if (
							error &&
							typeof error === "object" &&
							"type" in error &&
							error.type === "not_found"
						) {
							return new NotFoundError({
								message: "User not found",
								entityType: "user",
								entityId: userId,
							});
						}
						return new DatabaseError({
							message: "Failed to ban user",
							operation: "banUser",
							cause: error,
						});
					},
				}),

			unbanUser: (userId, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Check if user exists
						const [existingUser] = await db
							.select({ id: user.id })
							.from(user)
							.where(eq(user.id, userId))
							.limit(1);

						if (!existingUser) {
							throw { type: "not_found" };
						}

						// Clear ban
						await db
							.update(user)
							.set({
								banned: false,
								banReason: null,
								banExpires: null,
							})
							.where(eq(user.id, userId));

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "unban_user",
							targetType: "user",
							targetId: userId,
						});
					},
					catch: (error) => {
						if (
							error &&
							typeof error === "object" &&
							"type" in error &&
							error.type === "not_found"
						) {
							return new NotFoundError({
								message: "User not found",
								entityType: "user",
								entityId: userId,
							});
						}
						return new DatabaseError({
							message: "Failed to unban user",
							operation: "unbanUser",
							cause: error,
						});
					},
				}),

			listUserSessions: (userId) =>
				Effect.tryPromise({
					try: async () => {
						const sessions = await db
							.select({
								id: session.id,
								token: session.token,
								ipAddress: session.ipAddress,
								userAgent: session.userAgent,
								createdAt: session.createdAt,
								expiresAt: session.expiresAt,
								activeOrganizationId: session.activeOrganizationId,
								impersonatedBy: session.impersonatedBy,
							})
							.from(session)
							.where(eq(session.userId, userId))
							.orderBy(desc(session.createdAt));

						return sessions;
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to list user sessions",
							operation: "listUserSessions",
							cause: error,
						}),
				}),

			revokeSession: (sessionId, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Get session to find userId for audit
						const [existingSession] = await db
							.select({ id: session.id, userId: session.userId })
							.from(session)
							.where(eq(session.id, sessionId))
							.limit(1);

						if (!existingSession) {
							throw { type: "not_found" };
						}

						// Delete session
						await db.delete(session).where(eq(session.id, sessionId));

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "revoke_session",
							targetType: "session",
							targetId: sessionId,
							metadata: JSON.stringify({ userId: existingSession.userId }),
						});
					},
					catch: (error) => {
						if (
							error &&
							typeof error === "object" &&
							"type" in error &&
							error.type === "not_found"
						) {
							return new NotFoundError({
								message: "Session not found",
								entityType: "session",
								entityId: sessionId,
							});
						}
						return new DatabaseError({
							message: "Failed to revoke session",
							operation: "revokeSession",
							cause: error,
						});
					},
				}),

			revokeAllUserSessions: (userId, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Count sessions before deleting
						const [{ sessionCount }] = await db
							.select({ sessionCount: count() })
							.from(session)
							.where(eq(session.userId, userId));

						// Delete all sessions
						await db.delete(session).where(eq(session.userId, userId));

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "revoke_all_sessions",
							targetType: "user",
							targetId: userId,
							metadata: JSON.stringify({ sessionCount }),
						});

						return sessionCount;
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to revoke all user sessions",
							operation: "revokeAllUserSessions",
							cause: error,
						}),
				}),

			listOrganizations: (filters, pagination) =>
				Effect.tryPromise({
					try: async () => {
						const { search, status } = filters;
						const { page, pageSize } = pagination;
						const offset = (page - 1) * pageSize;

						// Build where conditions for organization
						const conditions = [];

						if (search) {
							conditions.push(
								or(
									ilike(organization.name, `%${search}%`),
									ilike(organization.slug, `%${search}%`),
								),
							);
						}

						if (status === "active") {
							conditions.push(isNull(organization.deletedAt));
						} else if (status === "deleted") {
							conditions.push(sql`${organization.deletedAt} IS NOT NULL`);
						}
						// For "suspended", we filter after joining

						const whereClause =
							conditions.length > 0 ? and(...conditions) : undefined;

						// Get organizations with counts
						const orgsWithCounts = await db
							.select({
								id: organization.id,
								name: organization.name,
								slug: organization.slug,
								logo: organization.logo,
								createdAt: organization.createdAt,
								deletedAt: organization.deletedAt,
								employeeCount: sql<number>`(
									SELECT COUNT(*) FROM ${employee}
									WHERE ${employee.organizationId} = ${organization.id}
									AND ${employee.isActive} = true
								)`.as("employee_count"),
								memberCount: sql<number>`(
									SELECT COUNT(*) FROM ${member}
									WHERE ${member.organizationId} = ${organization.id}
								)`.as("member_count"),
							})
							.from(organization)
							.where(whereClause)
							.orderBy(desc(organization.createdAt))
							.limit(pageSize)
							.offset(offset);

						// Get suspension status for each org
						const orgIds = orgsWithCounts.map((o) => o.id);
						const suspensions =
							orgIds.length > 0
								? await db
										.select({
											organizationId: organizationSuspension.organizationId,
											reason: organizationSuspension.reason,
										})
										.from(organizationSuspension)
										.where(
											and(
												inArray(organizationSuspension.organizationId, orgIds),
												eq(organizationSuspension.isActive, true),
											),
										)
								: [];

						const suspensionMap = new Map(
							suspensions.map((s) => [s.organizationId, s.reason]),
						);

						// Get total count
						const [{ total }] = await db
							.select({ total: count() })
							.from(organization)
							.where(whereClause);

						// Map results
						let data: PlatformOrganization[] = orgsWithCounts.map((org) => ({
							id: org.id,
							name: org.name,
							slug: org.slug,
							logo: org.logo,
							createdAt: org.createdAt,
							employeeCount: Number(org.employeeCount),
							memberCount: Number(org.memberCount),
							isSuspended: suspensionMap.has(org.id),
							suspendedReason: suspensionMap.get(org.id) ?? null,
							deletedAt: org.deletedAt,
						}));

						// Filter by suspended status if needed
						if (status === "suspended") {
							data = data.filter((org) => org.isSuspended);
						}

						return {
							data,
							total,
							page,
							pageSize,
							totalPages: Math.ceil(total / pageSize),
						};
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to list organizations",
							operation: "listOrganizations",
							cause: error,
						}),
				}),

			suspendOrganization: (orgId, reason, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Check if org exists
						const [existingOrg] = await db
							.select({ id: organization.id })
							.from(organization)
							.where(eq(organization.id, orgId))
							.limit(1);

						if (!existingOrg) {
							throw { type: "not_found" };
						}

						// Check if already suspended
						const [existingSuspension] = await db
							.select({ id: organizationSuspension.id })
							.from(organizationSuspension)
							.where(
								and(
									eq(organizationSuspension.organizationId, orgId),
									eq(organizationSuspension.isActive, true),
								),
							)
							.limit(1);

						if (existingSuspension) {
							throw { type: "conflict" };
						}

						// Create suspension record
						await db.insert(organizationSuspension).values({
							organizationId: orgId,
							reason,
							suspendedBy: adminId,
						});

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "suspend_org",
							targetType: "organization",
							targetId: orgId,
							metadata: JSON.stringify({ reason }),
						});
					},
					catch: (error) => {
						if (
							error &&
							typeof error === "object" &&
							"type" in error
						) {
							if (error.type === "not_found") {
								return new NotFoundError({
									message: "Organization not found",
									entityType: "organization",
									entityId: orgId,
								});
							}
							if (error.type === "conflict") {
								return new ConflictError({
									message: "Organization is already suspended",
									conflictType: "already_suspended",
								});
							}
						}
						return new DatabaseError({
							message: "Failed to suspend organization",
							operation: "suspendOrganization",
							cause: error,
						});
					},
				}),

			unsuspendOrganization: (orgId, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Find active suspension
						const [existingSuspension] = await db
							.select({ id: organizationSuspension.id })
							.from(organizationSuspension)
							.where(
								and(
									eq(organizationSuspension.organizationId, orgId),
									eq(organizationSuspension.isActive, true),
								),
							)
							.limit(1);

						if (!existingSuspension) {
							throw { type: "not_found" };
						}

						// Deactivate suspension
						await db
							.update(organizationSuspension)
							.set({
								isActive: false,
								unsuspendedAt: new Date(),
								unsuspendedBy: adminId,
							})
							.where(eq(organizationSuspension.id, existingSuspension.id));

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "unsuspend_org",
							targetType: "organization",
							targetId: orgId,
						});
					},
					catch: (error) => {
						if (
							error &&
							typeof error === "object" &&
							"type" in error &&
							error.type === "not_found"
						) {
							return new NotFoundError({
								message: "No active suspension found for organization",
								entityType: "organization_suspension",
								entityId: orgId,
							});
						}
						return new DatabaseError({
							message: "Failed to unsuspend organization",
							operation: "unsuspendOrganization",
							cause: error,
						});
					},
				}),

			deleteOrganization: (orgId, immediate, skipNotification, adminId) =>
				Effect.tryPromise({
					try: async () => {
						// Check if org exists
						const [existingOrg] = await db
							.select({ id: organization.id, name: organization.name })
							.from(organization)
							.where(eq(organization.id, orgId))
							.limit(1);

						if (!existingOrg) {
							throw { type: "not_found" };
						}

						if (immediate) {
							// Set deletedAt to now - the cleanup job will handle actual deletion
							// For truly immediate deletion, we'd call the cleanup function directly
							await db
								.update(organization)
								.set({
									deletedAt: new Date(),
									deletedBy: adminId,
								})
								.where(eq(organization.id, orgId));
						} else {
							// Schedule for 5 days from now (same as org owner deletion)
							const deletionDate = new Date();
							deletionDate.setDate(deletionDate.getDate() + 5);

							await db
								.update(organization)
								.set({
									deletedAt: deletionDate,
									deletedBy: adminId,
								})
								.where(eq(organization.id, orgId));
						}

						// Log action
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action: "delete_org",
							targetType: "organization",
							targetId: orgId,
							metadata: JSON.stringify({
								immediate,
								skipNotification,
								organizationName: existingOrg.name,
							}),
						});

						// TODO: If !skipNotification, trigger notification job
					},
					catch: (error) => {
						if (
							error &&
							typeof error === "object" &&
							"type" in error &&
							error.type === "not_found"
						) {
							return new NotFoundError({
								message: "Organization not found",
								entityType: "organization",
								entityId: orgId,
							});
						}
						return new DatabaseError({
							message: "Failed to delete organization",
							operation: "deleteOrganization",
							cause: error,
						});
					},
				}),

			isOrganizationSuspended: (orgId) =>
				Effect.tryPromise({
					try: async () => {
						const [suspension] = await db
							.select({ id: organizationSuspension.id })
							.from(organizationSuspension)
							.where(
								and(
									eq(organizationSuspension.organizationId, orgId),
									eq(organizationSuspension.isActive, true),
								),
							)
							.limit(1);

						return !!suspension;
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to check organization suspension status",
							operation: "isOrganizationSuspended",
							cause: error,
						}),
				}),

			logAction: (adminId, action, targetType, targetId, metadata) =>
				Effect.tryPromise({
					try: async () => {
						await db.insert(platformAdminAuditLog).values({
							adminUserId: adminId,
							action,
							targetType,
							targetId,
							metadata: metadata ? JSON.stringify(metadata) : null,
						});
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to log admin action",
							operation: "logAction",
							cause: error,
						}),
				}),

			getRecentAuditLogs: (limit = 50) =>
				Effect.tryPromise({
					try: async () => {
						const logs = await db
							.select({
								action: platformAdminAuditLog.action,
								targetType: platformAdminAuditLog.targetType,
								targetId: platformAdminAuditLog.targetId,
								metadata: platformAdminAuditLog.metadata,
								ipAddress: platformAdminAuditLog.ipAddress,
								createdAt: platformAdminAuditLog.createdAt,
							})
							.from(platformAdminAuditLog)
							.orderBy(desc(platformAdminAuditLog.createdAt))
							.limit(limit);

						return logs;
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to get audit logs",
							operation: "getRecentAuditLogs",
							cause: error,
						}),
				}),
		}),
	),
);
