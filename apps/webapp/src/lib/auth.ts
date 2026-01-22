import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import { employee, teamPermissions } from "@/db/schema";
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

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

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
		},
	},

	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		sendResetPassword: async ({ user, url }, _request) => {
			// Look up user's org for org-specific email config
			const organizationId = await getUserPrimaryOrganizationId(user.id);

			const html = await renderPasswordReset({
				userName: user.name,
				resetUrl: url,
			});

			await sendEmail({
				to: user.email,
				subject: "Reset your password",
				html,
				actionUrl: url,
				organizationId,
			});
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url, token }, _request) => {
			const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

			// Look up user's org for org-specific email config
			const organizationId = await getUserPrimaryOrganizationId(user.id);

			const html = await renderEmailVerification({
				userName: user.name,
				verificationUrl: url,
				appUrl,
			});

			await sendEmail({
				to: user.email,
				subject: "Verify your email address",
				html,
				actionUrl: url,
				organizationId,
			});
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // Cache duration in seconds (5 minutes)
			strategy: "compact", // Smallest cookie size, best performance
			refreshCache: {
				updateAge: 60, // Refresh cookie when 60 seconds from expiry
			},
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
				const appUrl =
					process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";
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

					const ssoRequiresApproval = (org as { ssoRequiresApproval?: boolean })?.ssoRequiresApproval ?? true;

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
	],
});
