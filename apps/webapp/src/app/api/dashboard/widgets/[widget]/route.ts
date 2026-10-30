import { NextResponse } from "next/server";
import {
	authorizeDashboardRead,
	DASHBOARD_READ_HEADERS,
} from "@/components/dashboard/authorize-dashboard-read";
import { readDashboardWidget } from "@/components/dashboard/dashboard-reads";
import { isServerWidgetId } from "@/components/dashboard/dashboard-types";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ widget: string }> },
) {
	const subject = await authorizeDashboardRead(request);
	if (subject instanceof NextResponse) return subject;
	const { widget } = await params;
	if (!isServerWidgetId(widget))
		return NextResponse.json(
			{ error: "Unknown widget" },
			{ status: 404, headers: DASHBOARD_READ_HEADERS },
		);
	return NextResponse.json(await readDashboardWidget(widget, subject), {
		headers: DASHBOARD_READ_HEADERS,
	});
}
