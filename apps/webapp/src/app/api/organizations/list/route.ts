import { NextResponse } from "next/server";
import { getUserOrganizations } from "@/lib/auth-helpers";

export async function GET() {
	try {
		const organizations = await getUserOrganizations();

		return NextResponse.json({
			organizations,
			count: organizations.length,
		});
	} catch (error) {
		// Rethrow prerender errors to let Next.js handle them
		if (error instanceof Error && "digest" in error) {
			throw error;
		}
		console.error("Error fetching organizations:", error);
		return NextResponse.json({ error: "Failed to fetch organizations" }, { status: 500 });
	}
}
