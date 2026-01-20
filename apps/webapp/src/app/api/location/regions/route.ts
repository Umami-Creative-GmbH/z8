import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { getRegions } from "@/lib/holidays/date-holidays-service";

export async function GET(request: NextRequest) {
	try {
		await connection();
		const { searchParams } = new URL(request.url);
		const country = searchParams.get("country");
		const state = searchParams.get("state");

		if (!country) {
			return NextResponse.json({ error: "Country code is required" }, { status: 400 });
		}

		if (!state) {
			return NextResponse.json({ error: "State code is required" }, { status: 400 });
		}

		const regions = getRegions(country, state);
		return NextResponse.json({ regions });
	} catch (error) {
		// Rethrow prerender errors to let Next.js handle them
		if (error instanceof Error && "digest" in error) {
			throw error;
		}
		console.error("Error fetching regions:", error);
		return NextResponse.json({ error: "Failed to fetch regions" }, { status: 500 });
	}
}
