import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
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
			});
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
			allowUserToCreateOrganization: true,
			organizationRoles: ["owner", "admin", "member"],
			creatorRole: "owner",
			sendInvitationEmail: async (data) => {
				const html = await renderOrganizationInvitation({
					email: data.email,
					organizationName: data.organization.name,
					inviterName: data.inviter.name,
					role: data.role,
					invitationUrl: data.url,
				});

				await sendEmail({
					to: data.email,
					subject: `You've been invited to join ${data.organization.name}`,
					html,
				});
			},
		}),
	],
});
