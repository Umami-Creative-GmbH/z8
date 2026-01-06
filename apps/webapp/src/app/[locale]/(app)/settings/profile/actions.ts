"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { passwordChangeSchema, profileUpdateSchema } from "@/lib/validations/profile";

/**
 * Update user profile (name and/or image)
 */
export async function updateProfile(data: { name: string; image?: string }) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return { success: false, error: "Not authenticated" };
		}

		// Validate input
		const result = profileUpdateSchema.safeParse(data);
		if (!result.success) {
			return { success: false, error: result.error.errors[0]?.message || "Invalid input" };
		}

		// Update user using Better Auth API
		const updateData: { name: string; image?: string } = { name: data.name };
		if (data.image) {
			updateData.image = data.image;
		}

		await auth.api.updateUser({
			body: updateData,
			headers: await headers(),
		});

		return { success: true };
	} catch (error) {
		console.error("Profile update error:", error);
		return { success: false, error: "Failed to update profile" };
	}
}

/**
 * Change user password
 */
export async function changePassword(data: {
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
	revokeOtherSessions?: boolean;
}) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return { success: false, error: "Not authenticated" };
		}

		// Validate input
		const result = passwordChangeSchema.safeParse(data);
		if (!result.success) {
			return { success: false, error: result.error.errors[0]?.message || "Invalid input" };
		}

		// Change password using Better Auth API
		await auth.api.changePassword({
			body: {
				currentPassword: data.currentPassword,
				newPassword: data.newPassword,
				revokeOtherSessions: data.revokeOtherSessions ?? false,
			},
			headers: await headers(),
		});

		return { success: true };
	} catch (error: any) {
		console.error("Password change error:", error);

		// Better Auth returns specific error messages
		if (
			error?.message?.includes("Invalid password") ||
			error?.message?.includes("Incorrect password")
		) {
			return { success: false, error: "Current password is incorrect" };
		}

		return { success: false, error: error?.message || "Failed to change password" };
	}
}
