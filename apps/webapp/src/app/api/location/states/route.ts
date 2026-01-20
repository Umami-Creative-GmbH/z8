import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { getStates } from "@/lib/holidays/date-holidays-service";

export async function GET(request: NextRequest) {
	try {
		await connection();
		const { searchParams } = new URL(request.url);
		const country = searchParams.get("country");

		if (!country) {
			return NextResponse.json({ error: "Country code is required" }, { status: 400 });
		}

		const states = getStates(country);
		return NextResponse.json({ states });
	} catch (error) {
		// Rethrow prerender errors to let Next.js handle them
		if (error instanceof Error && "digest" in error) {
			throw error;
		}
		console.error("Error fetching states:", error);
		return NextResponse.json({ error: "Failed to fetch states" }, { status: 500 });
	}
}
