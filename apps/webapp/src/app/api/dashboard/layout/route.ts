import { NextResponse } from "next/server";
import {
	authorizeDashboardRead,
	DASHBOARD_READ_HEADERS,
} from "@/components/dashboard/authorize-dashboard-read";
import { readDashboardLayout } from "@/components/dashboard/dashboard-reads";

export async function GET(request: Request) {
	const subject = await authorizeDashboardRead(request);
	if (subject instanceof NextResponse) return subject;
	return NextResponse.json(await readDashboardLayout(subject), {
		headers: DASHBOARD_READ_HEADERS,
	});
}
