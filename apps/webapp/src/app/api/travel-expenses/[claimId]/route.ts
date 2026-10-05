import { type NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
	loadAuthorizedTravelExpenseClaim,
	loadTravelExpenseClaimDetail,
} from "@/lib/travel-expenses/claim-read";

const logger = createLogger("TravelExpenseDetail");
export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ claimId: string }> },
) {
	try {
		const { claimId } = await params;
		const result = await loadAuthorizedTravelExpenseClaim(claimId);
		if (result.status !== "found")
			return NextResponse.json(
				{
					error:
						result.status === "unauthorized"
							? "Unauthorized"
							: "Travel expense claim not found",
				},
				{
					status: result.status === "unauthorized" ? 401 : 404,
					headers: { "Cache-Control": "private, no-store" },
				},
			);
		return NextResponse.json(await loadTravelExpenseClaimDetail(result.claim), {
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		logger.error({ error }, "Failed to load travel expense claim");
		return NextResponse.json(
			{ error: "Unable to load this claim. Please retry." },
			{ status: 500, headers: { "Cache-Control": "private, no-store" } },
		);
	}
}
