"use server";

import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth-helpers";

/**
 * Use in admin page server components to protect routes
 * Redirects to dashboard if user is not an admin
 *
 * @example
 * ```ts
 * export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
 *   const { locale } = await params;
 *   await adminGuard(locale);
 *
 *   return <AdminContent />;
 * }
 * ```
 */
export async function adminGuard(locale: string) {
	const hasAccess = await isAdmin();

	if (!hasAccess) {
		redirect(`/${locale}`); // Redirect to dashboard
	}
}
