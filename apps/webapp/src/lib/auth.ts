import { passkey } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, apiKey, bearer, organization, twoFactor } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import {
	employee,
	teamPermissions,
	scimProviderConfig,
	scimProvisioningLog,
	roleTemplate,
	roleTemplateMapping,
	userRoleTemplateAssignment,
	userLifecycleEvent,
} from "@/db/schema";
import { getDomainConfig, getDomainConfigByOrganization } from "./domain/domain-service";
import { sendEmail } from "./email/email-service";
import {
	renderEmailVerification,
	renderOrganizationInvitation,
	renderPasswordReset,
} from "./email/render";
import { createLogger } from "./logger";
import { secondaryStorage } from "./valkey";

const logger = createLogger("Auth");

/**
 * Get the primary organization ID for a user (for auth emails)
 * Returns the first organization the user is a member of
 */
async function getUserPrimaryOrganizationId(userId: string): Promise<string | undefined> {
	try {
		const membership = await db.query.member.findFirst({
			where: eq(schema.member.userId, userId),
			columns: { organizationId: true },
		});
		return membership?.organizationId;
	} catch (error) {
		logger.warn({ error, userId }, "Failed to get user organization for email");
		return undefined;
	}
}

/**
 * Get the base URL for an organization, using their custom domain if verified
 */
async function getBaseUrlForOrganization(organizationId?: string): Promise<string> {
	const defaultUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

	if (!organizationId) return defaultUrl;

	try {
		const domainConfig = await getDomainConfigByOrganization(organizationId);
		if (domainConfig?.domainVerified) {
			return `https://${domainConfig.domain}`;
		}
	} catch (error) {
		logger.warn({ error, organizationId }, "Failed to get custom domain for organization");
	}

	return defaultUrl;
}

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

	// Dynamic trusted origins for custom domains
	// This allows auth requests from verified custom domains that proxy to the app
	trustedOrigins: async (request) => {
		const origins = [
			process.env.BETTER_AUTH_URL || "http://localhost:3000",
			process.env.NEXT_PUBLIC_APP_URL,
		].filter(Boolean) as string[];

		if (!request) return origins;

		const host = request.headers.get("host");
		if (!host) return origins;

		// Add current host to trusted origins
		const protocol = host.includes("localhost") ? "http" : "https";
		const currentOrigin = `${protocol}://${host}`;
		origins.push(currentOrigin);

		// Verify against registered custom domains
		const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
		try {
			const domainConfig = await getDomainConfig(normalizedHost);
			if (domainConfig) {
				// domainConfig is only returned if domain is verified (see getDomainConfig implementation)
				origins.push(`https://${normalizedHost}`);
			}
		} catch (error) {
			logger.warn({ error, host }, "Failed to verify custom domain for trusted origins");
		}

		return [...new Set(origins)];
	},

	// Enable experimental database joins for 2-3x faster queries
	experimental: {
		joins: true,
	},

	// Secondary storage for session caching (Valkey/Redis)
	// This dramatically improves session retrieval performance
	secondaryStorage,

	// User additional fields - these will be included in the generated schema
	user: {
		additionalFields: {
			canCreateOrganizations: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: false, // system-managed, not user-provided
			},
			invitedVia: {
				type: "string",
				required: false,
				input: false,
			},
			// Stores invite code during registration until email is verified
			// Processed by afterVerification hook to auto-join organization
			pendingInviteCode: {
				type: "string",
				required: false,
				input: false, // system-managed
			},
			// App access permissions - control which applications the user can access
			canUseWebapp: {
				type: "boolean",
				required: false,
				defaultValue: true,
				input: false, // admin-managed only
			},
			canUseDesktop: {
				type: "boolean",
				required: false,
				defaultValue: true,
				input: false, // admin-managed only
			},
			canUseMobile: {
				type: "boolean",
				required: false,
				defaultValue: true,
				input: false, // admin-managed only
			},
		},
	},

	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		sendResetPassword: async ({ user, url }, _request) => {
			// Look up user's org for org-specific email config and custom domain
			const organizationId = await getUserPrimaryOrganizationId(user.id);
			const appUrl = await getBaseUrlForOrganization(organizationId);

			// Rewrite URL to use correct base (organization's custom domain if available)
			const urlObj = new URL(url);
			const correctedUrl = `${appUrl}${urlObj.pathname}${urlObj.search}`;

			const html = await renderPasswordReset({
				userName: user.name,
				resetUrl: correctedUrl,
			});

			await sendEmail({
				to: user.email,
				subject: "Reset your password",
				html,
				actionUrl: correctedUrl,
				organizationId,
			});
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url, token }, _request) => {
			// Look up user's org for org-specific email config and custom domain
			const organizationId = await getUserPrimaryOrganizationId(user.id);
			const appUrl = await getBaseUrlForOrganization(organizationId);

			// Rewrite URL to use correct base (organization's custom domain if available)
			const urlObj = new URL(url);
			const correctedUrl = `${appUrl}${urlObj.pathname}${urlObj.search}`;

			const html = await renderEmailVerification({
				userName: user.name,
				verificationUrl: correctedUrl,
				appUrl,
			});

			await sendEmail({
				to: user.email,
				subject: "Verify your email address",
				html,
				actionUrl: correctedUrl,
				organizationId,
			});
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // Cache duration in seconds (5 minutes)
			strategy: "compact", // Smallest cookie size, best performance
		},
		// When using secondary storage, don't store sessions in DB for performance
		// Sessions are cached in Valkey which is much faster
		storeSessionInDatabase: true, // Keep DB as source of truth for revocation
	},
	// Use secondary storage for rate limiting as well
	rateLimit: {
		storage: "secondary-storage",
	},
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
			enabled: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
		},
		github: {
			clientId: process.env.GITHUB_CLIENT_ID || "",
			clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
			enabled: !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET,
		},
		linkedin: {
			clientId: process.env.LINKEDIN_CLIENT_ID || "",
			clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
			enabled: !!process.env.LINKEDIN_CLIENT_ID && !!process.env.LINKEDIN_CLIENT_SECRET,
		},
		apple: {
			clientId: process.env.APPLE_CLIENT_ID || "",
			clientSecret: process.env.APPLE_CLIENT_SECRET || "",
			enabled: !!process.env.APPLE_CLIENT_ID && !!process.env.APPLE_CLIENT_SECRET,
		},
	},
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	plugins: [
		nextCookies(),
		bearer(), // Enable Bearer token auth for desktop app
		admin({
			defaultRole: "user",
			adminRole: "admin",
		}),
		organization({
			allowUserToCreateOrganization: async (user) => {
				// Check if user has permission to create organizations
				const userRecord = await db.query.user.findFirst({
					where: eq(schema.user.id, user.id),
				});
				// System admins can always create organizations
				if (userRecord?.role === "admin") {
					return true;
				}
				return userRecord?.canCreateOrganizations ?? false;
			},
			organizationRoles: ["owner", "admin", "member"],
			creatorRole: "owner",
			// Schema customization for organization and invitation tables
			schema: {
				organization: {
					additionalFields: {
						country: {
							type: "string",
							required: false,
							input: true,
						},
						region: {
							type: "string",
							required: false,
							input: true,
						},
						shiftsEnabled: {
							type: "boolean",
							required: false,
							defaultValue: false,
							input: true,
						},
						projectsEnabled: {
							type: "boolean",
							required: false,
							defaultValue: false,
							input: true,
						},
						surchargesEnabled: {
							type: "boolean",
							required: false,
							defaultValue: false,
							input: true,
						},
						timezone: {
							type: "string",
							required: false,
							defaultValue: "UTC",
							input: true, // admin can set organization timezone
						},
						deletedAt: {
							type: "date",
							required: false,
							input: false, // system-managed
						},
						deletedBy: {
							type: "string",
							required: false,
							input: false, // system-managed, stores user ID
						},
						// SSO approval configuration: when true, SSO users need approval
						ssoRequiresApproval: {
							type: "boolean",
							required: false,
							defaultValue: true,
							input: true,
						},
					},
				},
				member: {
					additionalFields: {
						// Member status for invite code approval flow
						// "pending" = awaiting admin approval, "approved" = active member, "rejected" = rejected
						status: {
							type: "string",
							required: false,
							defaultValue: "approved", // existing members are approved by default
							input: false, // system-managed
						},
						// Reference to the invite code used to join (if any)
						inviteCodeId: {
							type: "string",
							required: false,
							input: false,
						},
					},
				},
				invitation: {
					additionalFields: {
						canCreateOrganizations: {
							type: "boolean",
							required: false,
							defaultValue: false,
							input: true,
						},
					},
				},
			},
			sendInvitationEmail: async (data) => {
				// Use organization's custom domain if verified
				const appUrl = await getBaseUrlForOrganization(data.organization.id);
				const invitationUrl = `${appUrl}/accept-invitation/${data.invitation.id}`;

				const html = await renderOrganizationInvitation({
					email: data.email,
					organizationName: data.organization.name,
					inviterName: data.inviter.user.name,
					role: data.role,
					invitationUrl,
				});

				await sendEmail({
					to: data.email,
					subject: `You've been invited to join ${data.organization.name}`,
					html,
					actionUrl: invitationUrl,
					organizationId: data.organization.id, // Use org-specific email config
				});
			},
			organizationHooks: {
				// Update user permissions when accepting invitation
				afterAcceptInvitation: async ({ user, invitation }) => {
					// Fetch the full invitation record to get canCreateOrganizations
					const invitationRecord = await db.query.invitation.findFirst({
						where: eq(schema.invitation.id, invitation.id),
					});

					// Update user's organization creation permission based on invitation
					await db
						.update(schema.user)
						.set({
							canCreateOrganizations: invitationRecord?.canCreateOrganizations ?? false,
							invitedVia: invitation.id,
						})
						.where(eq(schema.user.id, user.id));
				},

				// Create employee record when user is added to organization
				afterAddMember: async ({ member, user, organization }) => {
					// Check if employee record already exists
					const existingEmployee = await db.query.employee.findFirst({
						where: (employee, { eq, and }) =>
							and(eq(employee.userId, user.id), eq(employee.organizationId, organization.id)),
					});

					if (!existingEmployee) {
						// Create employee record
						const [newEmployee] = await db
							.insert(employee)
							.values({
								userId: user.id,
								organizationId: organization.id,
								role: member.role === "owner" || member.role === "admin" ? "admin" : "employee",
								isActive: true,
							})
							.returning();

						// Grant all team permissions to admins by default
						if (member.role === "admin" || member.role === "owner") {
							await db.insert(teamPermissions).values({
								employeeId: newEmployee.id,
								organizationId: organization.id,
								teamId: null, // null = organization-wide permissions
								canCreateTeams: true,
								canManageTeamMembers: true,
								canManageTeamSettings: true,
								canApproveTeamRequests: true,
								grantedBy: newEmployee.id,
							});
						}
					}

					// Sync seat count to Stripe if billing is enabled
					if (process.env.BILLING_ENABLED === "true") {
						try {
							const { Effect, Layer } = await import("effect");
							const {
								SeatSyncService,
								SeatSyncServiceLive,
								StripeServiceLive,
								SubscriptionServiceLive,
							} = await import("@/lib/effect/services/billing");

							const layers = SeatSyncServiceLive.pipe(
								Layer.provide(StripeServiceLive),
								Layer.provide(SubscriptionServiceLive),
							);

							const program = Effect.gen(function* () {
								const seatSyncService = yield* SeatSyncService;
								yield* seatSyncService.handleMemberAdded(
									organization.id,
									member.id,
									user.id,
								);
							});

							await Effect.runPromise(program.pipe(Effect.provide(layers)));
						} catch (error) {
							// Log but don't fail - seat sync is non-blocking
							logger.error({ error, organizationId: organization.id }, "Failed to sync seats after member added");
						}
					}
				},

				// Sync seat count when member is removed
				afterRemoveMember: async ({ member, organization }) => {
					if (process.env.BILLING_ENABLED === "true") {
						try {
							const { Effect, Layer } = await import("effect");
							const {
								SeatSyncService,
								SeatSyncServiceLive,
								StripeServiceLive,
								SubscriptionServiceLive,
							} = await import("@/lib/effect/services/billing");

							const layers = SeatSyncServiceLive.pipe(
								Layer.provide(StripeServiceLive),
								Layer.provide(SubscriptionServiceLive),
							);

							const program = Effect.gen(function* () {
								const seatSyncService = yield* SeatSyncService;
								yield* seatSyncService.handleMemberRemoved(
									organization.id,
									member.id,
									member.userId,
								);
							});

							await Effect.runPromise(program.pipe(Effect.provide(layers)));
						} catch (error) {
							logger.error({ error, organizationId: organization.id }, "Failed to sync seats after member removed");
						}
					}
				},
			},
		}),
		twoFactor({
			issuer: "Z8",
			backupCodeLength: 8,
			backupCodeCount: 10,
		}),
		passkey({
			rpName: "Z8",
			// rpID must be a static string - passkeys are domain-bound by WebAuthn spec.
			// Users accessing via custom domains will need to register separate passkeys.
			// For multi-tenant with custom domains, consider using the origin option instead.
			rpID: process.env.PASSKEY_RP_ID || "localhost",
		}),
		sso({
			// Enable domain verification for SSO providers
			domainVerification: {
				enabled: true,
				tokenPrefix: "z8-auth-",
			},
			// Organization provisioning: auto-add users to linked organizations
			organizationProvisioning: {
				disabled: false,
				defaultRole: "member",
				getRole: async ({ userInfo }) => {
					// Default to member, can be customized based on userInfo attributes
					// Example: check for admin role in SSO provider attributes
					const role = userInfo?.attributes?.role;
					if (role === "admin" || role === "manager") {
						return "admin";
					}
					return "member";
				},
			},
			// Provision user when they sign in through SSO
			provisionUser: async ({ user, provider }) => {
				// If provider is linked to an organization, check/create employee record
				if (provider.organizationId) {
					// Check if org requires SSO approval
					const org = await db.query.organization.findFirst({
						where: eq(schema.organization.id, provider.organizationId),
					});

					const ssoRequiresApproval =
						(org as { ssoRequiresApproval?: boolean })?.ssoRequiresApproval ?? true;

					const existingEmployee = await db.query.employee.findFirst({
						where: (emp, { eq, and }) =>
							and(eq(emp.userId, user.id), eq(emp.organizationId, provider.organizationId!)),
					});

					if (!existingEmployee) {
						// Create employee record - isActive depends on approval setting
						await db.insert(employee).values({
							userId: user.id,
							organizationId: provider.organizationId,
							role: "employee",
							isActive: !ssoRequiresApproval, // inactive if approval required
						});
					}
				}
			},
		}),
		// API Key plugin for organization-level API access
		// Organization-specific data (organizationId, scopes, etc.) is stored in the metadata field
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used at runtime
		apiKey({
			// Rate limiting configuration
			rateLimit: {
				enabled: true,
				timeWindow: 60 * 1000, // 1 minute
				maxRequests: 100, // 100 requests per minute default
			},
			// Enable metadata storage for additional key info (organizationId, scopes, displayName, createdBy)
			enableMetadata: true,
		}),
		// SCIM 2.0 provisioning for enterprise identity management
		// Integrates with Azure AD, Okta, Google Workspace, and generic SCIM 2.0 providers
		// User lifecycle events are handled via databaseHooks below
		scim({
			// Store SCIM tokens encrypted for security
			storeSCIMToken: "encrypted",
			// Token generation hooks for security and audit
			beforeSCIMTokenGenerated: async ({ user, member }) => {
				// Only org admins/owners can generate SCIM tokens
				if (member && member.role !== "admin" && member.role !== "owner") {
					throw new Error("Only organization admins can generate SCIM tokens");
				}
				logger.info({ userId: user.id, memberRole: member?.role }, "SCIM token generation requested");
			},
			afterSCIMTokenGenerated: async ({ user, scimProvider }) => {
				// Log SCIM provider creation for audit
				if (scimProvider.organizationId) {
					await db.insert(scimProvisioningLog).values({
						organizationId: scimProvider.organizationId,
						eventType: "user_created", // Using as "provider_created" equivalent
						userId: user.id,
						metadata: {
							idpProvider: "scim",
							scimDisplayName: `SCIM Provider ${scimProvider.providerId}`,
						},
					});
				}
			},
		}),
	],
});
