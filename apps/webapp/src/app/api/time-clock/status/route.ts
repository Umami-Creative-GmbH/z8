import { connection, NextResponse } from "next/server";
import { getTimeClockStatus } from "@/app/[locale]/(app)/time-tracking/actions";
import {
	serializeWebClockStatus,
	WEB_CLOCK_STATUS_UNAVAILABLE,
} from "@/lib/time-tracking/web-clock-status";

const headers = { "Cache-Control": "private, no-store" };
/** Web-only transport adapter. The existing reader owns identity and tenant admission. */
export async function GET() {
	try {
		await connection();
		return NextResponse.json(
			serializeWebClockStatus(await getTimeClockStatus()),
			{ headers },
		);
	} catch {
		return NextResponse.json(
			{ error: WEB_CLOCK_STATUS_UNAVAILABLE },
			{ status: 500, headers },
		);
	}
}
