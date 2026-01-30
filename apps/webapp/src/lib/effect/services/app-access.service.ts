import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { user } from "@/db/auth-schema";
import { type AppType, logAppAccessChange, logAppAccessDenied } from "@/lib/audit-logger";
import { AppAccessDeniedError, type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

/**
 * App access permissions for a user
 */
export interface AppPermissions {
	canUseWebapp: boolean;
	canUseDesktop: boolean;
	canUseMobile: boolean;
}

/**
 * Result of app access check
 */
export interface AppAccessCheckResult {
	allowed: boolean;
	appType: AppType;
	permissions: AppPermissions;
}

/**
 * Detect app type from request headers
 * Bearer token = desktop/mobile, Cookie = webapp
 */
export function detectAppType(headers: Headers): AppType {
	const authHeader = headers.get("authorization");

	// Bearer token = desktop or mobile app
	if (authHeader?.toLowerCase().startsWith("bearer ")) {
		// Distinguish by user-agent
		const userAgent = headers.get("user-agent")?.toLowerCase() || "";
		if (
			userAgent.includes("mobile") ||
			userAgent.includes("android") ||
			userAgent.includes("ios") ||
			userAgent.includes("react native")
		) {
			return "mobile";
		}
		return "desktop";
	}

	// Cookie auth = webapp
	return "webapp";
}

/**
 * AppAccessService - manages user access to different applications
 *
 * Provides:
 * - App type detection from request headers
 * - User permission checks
 * - Permission updates with audit logging
 */
export class AppAccessService extends Context.Tag("AppAccessService")<
	AppAccessService,
	{
		/**
		 * Check if a user has access to the detected app type
		 * Returns the result without throwing
		 */
		readonly checkAccess: (
			userId: string,
			headers: Headers,
		) => Effect.Effect<AppAccessCheckResult, NotFoundError | DatabaseError>;

		/**
		 * Validate app access - throws AppAccessDeniedError if denied
		 * Use this for enforcing access control
		 */
		readonly validateAccess: (
			userId: string,
			headers: Headers,
		) => Effect.Effect<AppType, AppAccessDeniedError | NotFoundError | DatabaseError>;

		/**
		 * Get current app permissions for a user
		 */
		readonly getPermissions: (
			userId: string,
		) => Effect.Effect<AppPermissions, NotFoundError | DatabaseError>;

		/**
		 * Update app permissions for a user
		 * Requires admin context for audit logging
		 */
		readonly updatePermissions: (params: {
			userId: string;
			permissions: Partial<AppPermissions>;
			changedBy: string;
			changedByEmail: string;
			organizationId: string;
			targetUserName: string;
			targetUserEmail: string;
		}) => Effect.Effect<AppPermissions, NotFoundError | DatabaseError>;
	}
>() {}

export const AppAccessServiceLive = Layer.effect(
	AppAccessService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return AppAccessService.of({
			checkAccess: (userId, headers) =>
				Effect.gen(function* (_) {
					const appType = detectAppType(headers);

					// Get user with app permissions
					const userRecord = yield* _(
						dbService.query("getUserAppPermissions", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, userId),
								columns: {
									id: true,
									canUseWebapp: true,
									canUseDesktop: true,
									canUseMobile: true,
								},
							});
						}),
					);

					if (!userRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "User not found",
									entityType: "user",
									entityId: userId,
								}),
							),
						);
					}

					const permissions: AppPermissions = {
						canUseWebapp: userRecord!.canUseWebapp ?? true,
						canUseDesktop: userRecord!.canUseDesktop ?? true,
						canUseMobile: userRecord!.canUseMobile ?? true,
					};

					let allowed = true;
					if (appType === "webapp" && !permissions.canUseWebapp) {
						allowed = false;
					} else if (appType === "desktop" && !permissions.canUseDesktop) {
						allowed = false;
					} else if (appType === "mobile" && !permissions.canUseMobile) {
						allowed = false;
					}

					return { allowed, appType, permissions };
				}),

			validateAccess: (userId, headers) =>
				Effect.gen(function* (_) {
					const appType = detectAppType(headers);

					// Get user with app permissions and details for logging
					const userRecord = yield* _(
						dbService.query("getUserAppPermissionsForValidation", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, userId),
								columns: {
									id: true,
									name: true,
									email: true,
									canUseWebapp: true,
									canUseDesktop: true,
									canUseMobile: true,
								},
							});
						}),
					);

					if (!userRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "User not found",
									entityType: "user",
									entityId: userId,
								}),
							),
						);
					}

					const canUseWebapp = userRecord!.canUseWebapp ?? true;
					const canUseDesktop = userRecord!.canUseDesktop ?? true;
					const canUseMobile = userRecord!.canUseMobile ?? true;

					let allowed = true;
					let deniedReason = "";

					if (appType === "webapp" && !canUseWebapp) {
						allowed = false;
						deniedReason = "Your account does not have access to the web application.";
					} else if (appType === "desktop" && !canUseDesktop) {
						allowed = false;
						deniedReason = "Your account does not have access to the desktop application.";
					} else if (appType === "mobile" && !canUseMobile) {
						allowed = false;
						deniedReason = "Your account does not have access to the mobile application.";
					}

					if (!allowed) {
						// Log the denied access attempt
						yield* _(
							Effect.promise(async () =>
								logAppAccessDenied({
									userId: userRecord!.id,
									userName: userRecord!.name,
									userEmail: userRecord!.email,
									appType,
									ipAddress:
										headers.get("x-forwarded-for") || headers.get("x-real-ip") || undefined,
									userAgent: headers.get("user-agent") || undefined,
								}),
							),
						);

						yield* _(
							Effect.fail(
								new AppAccessDeniedError({
									message: `${deniedReason} Please contact your administrator.`,
									appType,
									userId,
								}),
							),
						);
					}

					return appType;
				}),

			getPermissions: (userId) =>
				Effect.gen(function* (_) {
					const userRecord = yield* _(
						dbService.query("getUserPermissions", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, userId),
								columns: {
									canUseWebapp: true,
									canUseDesktop: true,
									canUseMobile: true,
								},
							});
						}),
					);

					if (!userRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "User not found",
									entityType: "user",
									entityId: userId,
								}),
							),
						);
					}

					return {
						canUseWebapp: userRecord!.canUseWebapp ?? true,
						canUseDesktop: userRecord!.canUseDesktop ?? true,
						canUseMobile: userRecord!.canUseMobile ?? true,
					};
				}),

			updatePermissions: (params) =>
				Effect.gen(function* (_) {
					const {
						userId,
						permissions,
						changedBy,
						changedByEmail,
						organizationId,
						targetUserName,
						targetUserEmail,
					} = params;

					// Get current permissions for comparison
					const currentUser = yield* _(
						dbService.query("getCurrentUserPermissions", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, userId),
								columns: {
									canUseWebapp: true,
									canUseDesktop: true,
									canUseMobile: true,
								},
							});
						}),
					);

					if (!currentUser) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "User not found",
									entityType: "user",
									entityId: userId,
								}),
							),
						);
					}

					const currentPermissions: AppPermissions = {
						canUseWebapp: currentUser!.canUseWebapp ?? true,
						canUseDesktop: currentUser!.canUseDesktop ?? true,
						canUseMobile: currentUser!.canUseMobile ?? true,
					};

					// Build update object with only changed fields
					const updateData: Partial<AppPermissions> = {};
					if (permissions.canUseWebapp !== undefined) {
						updateData.canUseWebapp = permissions.canUseWebapp;
					}
					if (permissions.canUseDesktop !== undefined) {
						updateData.canUseDesktop = permissions.canUseDesktop;
					}
					if (permissions.canUseMobile !== undefined) {
						updateData.canUseMobile = permissions.canUseMobile;
					}

					// Only update if there are changes
					if (Object.keys(updateData).length > 0) {
						yield* _(
							dbService.query("updateUserAppPermissions", async () => {
								await dbService.db.update(user).set(updateData).where(eq(user.id, userId));
							}),
						);

						// Log audit events for each changed permission
						const logPromises: Promise<void>[] = [];

						if (
							permissions.canUseWebapp !== undefined &&
							permissions.canUseWebapp !== currentPermissions.canUseWebapp
						) {
							logPromises.push(
								logAppAccessChange({
									userId,
									userName: targetUserName,
									userEmail: targetUserEmail,
									appType: "webapp",
									granted: permissions.canUseWebapp,
									changedBy,
									changedByEmail,
									organizationId,
								}),
							);
						}

						if (
							permissions.canUseDesktop !== undefined &&
							permissions.canUseDesktop !== currentPermissions.canUseDesktop
						) {
							logPromises.push(
								logAppAccessChange({
									userId,
									userName: targetUserName,
									userEmail: targetUserEmail,
									appType: "desktop",
									granted: permissions.canUseDesktop,
									changedBy,
									changedByEmail,
									organizationId,
								}),
							);
						}

						if (
							permissions.canUseMobile !== undefined &&
							permissions.canUseMobile !== currentPermissions.canUseMobile
						) {
							logPromises.push(
								logAppAccessChange({
									userId,
									userName: targetUserName,
									userEmail: targetUserEmail,
									appType: "mobile",
									granted: permissions.canUseMobile,
									changedBy,
									changedByEmail,
									organizationId,
								}),
							);
						}

						// Fire and forget audit logs
						yield* _(Effect.promise(async () => Promise.all(logPromises)));
					}

					// Return the new permissions
					return {
						canUseWebapp: updateData.canUseWebapp ?? currentPermissions.canUseWebapp,
						canUseDesktop: updateData.canUseDesktop ?? currentPermissions.canUseDesktop,
						canUseMobile: updateData.canUseMobile ?? currentPermissions.canUseMobile,
					};
				}),
		});
	}),
);
