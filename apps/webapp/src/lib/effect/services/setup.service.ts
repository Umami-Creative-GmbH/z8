import { eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { db } from "@/db";
import { account, user } from "@/db/auth-schema";
import { platformAdminAuditLog } from "@/db/schema";
import { setupBootstrap } from "@/lib/setup/bootstrap.server";
import { setConfiguredStatus } from "@/lib/setup/config-cache";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	ValidationError,
} from "../errors";

// Types
export interface CreatePlatformAdminInput {
	name: string;
	email: string;
	password: string;
}

export interface PlatformAdminResult {
	userId: string;
	email: string;
}

// Validation helpers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function validateEmail(email: string): string | null {
	if (!email || !EMAIL_REGEX.test(email)) {
		return "Please enter a valid email address";
	}
	return null;
}

function validatePassword(password: string): string | null {
	if (!password || password.length < MIN_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
	}
	if (password.length > MAX_PASSWORD_LENGTH) {
		return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
	}
	if (!/[A-Z]/.test(password)) {
		return "Password must contain at least one uppercase letter";
	}
	if (!/[a-z]/.test(password)) {
		return "Password must contain at least one lowercase letter";
	}
	if (!/[0-9]/.test(password)) {
		return "Password must contain at least one number";
	}
	return null;
}

function validateName(name: string): string | null {
	if (!name || name.trim().length < 2) {
		return "Name must be at least 2 characters";
	}
	return null;
}

// Service interface
export class SetupService extends Context.Tag("SetupService")<
	SetupService,
	{
		/**
		 * Check if platform is already configured (has at least one platform admin)
		 */
		readonly isConfigured: () => Effect.Effect<boolean, DatabaseError>;

		/**
		 * Create the first platform admin.
		 * This can only be called when no platform admin exists.
		 * Uses a transaction with row locking to prevent race conditions.
		 */
		readonly createPlatformAdmin: (
			input: CreatePlatformAdminInput,
			setupToken: string | undefined,
		) => Effect.Effect<
			PlatformAdminResult,
			AuthorizationError | ValidationError | ConflictError | DatabaseError
		>;
	}
>() {}

// Service implementation
export const SetupServiceLive = Layer.effect(
	SetupService,
	Effect.sync(() =>
		SetupService.of({
			isConfigured: () =>
				Effect.tryPromise({
					try: async () => {
						const [admin] = await db
							.select({ id: user.id })
							.from(user)
							.where(eq(user.role, "admin"))
							.limit(1);

						return !!admin;
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to check platform configuration",
							operation: "isConfigured",
							cause: error,
						}),
				}),

			createPlatformAdmin: (input, setupToken) =>
				Effect.tryPromise({
					try: async () => {
						const assertSetupAuthorization = (authorized: boolean) => {
							if (!authorized) {
								throw new AuthorizationError({
									message:
										"Setup authorization is missing or expired. Open the setup link from the server console.",
								});
							}
						};
						assertSetupAuthorization(
							await setupBootstrap.authorize(setupToken),
						);
						// Validate input before hashing or opening the write transaction.
						const nameError = validateName(input.name);
						if (nameError) {
							throw new ValidationError({
								message: nameError,
								field: "name",
								value: input.name,
							});
						}

						const emailError = validateEmail(input.email);
						if (emailError) {
							throw new ValidationError({
								message: emailError,
								field: "email",
								value: input.email,
							});
						}

						const passwordError = validatePassword(input.password);
						if (passwordError) {
							throw new ValidationError({
								message: passwordError,
								field: "password",
							});
						}

						// Hash password before transaction
						const { hashPassword } = await import("better-auth/crypto");
						const hashedPassword = await hashPassword(input.password);

						// Generate unique IDs
						const userId = crypto.randomUUID();
						const accountId = crypto.randomUUID();
						const now = new Date();
						const normalizedEmail = input.email.toLowerCase();

						// Use a transaction with advisory lock to prevent race conditions
						// This ensures only one admin can be created even with concurrent requests
						const result = await db.transaction(async (tx) => {
							// Acquire advisory lock (prevents concurrent setup operations)
							// Using a fixed lock key for "platform_setup" operation
							const SETUP_LOCK_KEY = 1234567890; // Fixed key for setup operation
							await tx.execute(
								sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`,
							);

							// Check if any platform admin already exists (within transaction)
							const [existingAdmin] = await tx
								.select({ id: user.id })
								.from(user)
								.where(eq(user.role, "admin"))
								.limit(1);

							if (existingAdmin) {
								throw new ConflictError({
									message: "Platform is already configured",
									conflictType: "platform_already_configured",
								});
							}
							// The cookie may expire while hashing or waiting for the lock.
							// Admin existence was checked on tx above. Only recheck Redis here:
							// a global DB query would need a second pooled connection.
							assertSetupAuthorization(
								await setupBootstrap.authorizeWithinSetupTransaction(
									setupToken,
								),
							);

							// Check if email is already in use
							const [existingUser] = await tx
								.select({ id: user.id })
								.from(user)
								.where(eq(user.email, normalizedEmail))
								.limit(1);

							if (existingUser) {
								throw new ValidationError({
									message: "This email is already registered",
									field: "email",
								});
							}

							// Create user with admin role
							await tx.insert(user).values({
								id: userId,
								name: input.name.trim(),
								email: normalizedEmail,
								emailVerified: true, // Skip email verification for first admin
								role: "admin",
								createdAt: now,
								updatedAt: now,
								canCreateOrganizations: true, // Platform admins can create orgs
							});

							// Create credential account for password login
							await tx.insert(account).values({
								id: accountId,
								accountId: userId,
								providerId: "credential",
								userId: userId,
								password: hashedPassword,
								createdAt: now,
								updatedAt: now,
							});

							// Log the setup completion
							await tx.insert(platformAdminAuditLog).values({
								adminUserId: userId,
								action: "platform_setup",
								targetType: "platform",
								targetId: "initial_setup",
								metadata: JSON.stringify({
									adminEmail: normalizedEmail,
									timestamp: now.toISOString(),
								}),
							});

							return { userId, email: normalizedEmail };
						});

						// Consume only after commit so a rolled-back transaction remains retryable.
						// The DB admin check permanently denies leftover Redis credentials if cleanup fails.
						try {
							await setupBootstrap.invalidate();
						} catch {
							console.warn(
								"[Setup] Admin created; Redis bootstrap cleanup unavailable. Setup remains disabled by the database admin check.",
							);
						}
						try {
							setConfiguredStatus(true);
						} catch {
							console.warn(
								"[Setup] Admin created; configuration cache refresh unavailable.",
							);
						}

						return result;
					},
					catch: (error) => {
						// Re-throw typed errors as-is
						if (error instanceof AuthorizationError) {
							return error;
						}
						if (error instanceof ValidationError) {
							return error;
						}
						if (error instanceof ConflictError) {
							return error;
						}

						return new DatabaseError({
							message: "Failed to create platform admin",
							operation: "createPlatformAdmin",
							cause: error,
						});
					},
				}),
		}),
	),
);
