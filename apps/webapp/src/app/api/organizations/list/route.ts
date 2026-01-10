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
		console.error("Error fetching organizations:", error);
		return NextResponse.json({ error: "Failed to fetch organizations" }, { status: 500 });
	}
}
