import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
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

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		sendResetPassword: async ({ user, url }, _request) => {
			const html = await renderPasswordReset({
				userName: user.name,
				resetUrl: url,
			});

			await sendEmail({
				to: user.email,
				subject: "Reset your password",
				html,
				actionUrl: url,
			});
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url, token }, _request) => {
			const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

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
			});
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // Cache duration in seconds (5 minutes)
		},
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
			sendInvitationEmail: async (data) => {
				const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";
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
								teamId: organization.id, // Organization-wide permissions
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
	],
});
