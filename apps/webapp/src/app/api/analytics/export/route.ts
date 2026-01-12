/**
 * Analytics Export API Route
 *
 * POST endpoint for exporting analytics data as CSV or Excel files.
 * Requires authentication and validates export requests.
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateCsv } from "@/lib/reporting/csv-export";
import { generateExcelBuffer } from "@/lib/reporting/excel-export";

type ExportFormat = "csv" | "excel";

type ExportRequestBody = {
	format: ExportFormat;
	data: Record<string, any>[];
	headers: Array<{
		key: string;
		label: string;
	}>;
	filename: string;
};

export async function POST(request: NextRequest) {
	try {
		// Authentication check
		const session = await auth.api.getSession({
			headers: request.headers,
		});

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Parse and validate request body
		const body = (await request.json()) as ExportRequestBody;

		if (!body.format || !body.data || !body.headers || !body.filename) {
			return NextResponse.json(
				{ error: "Missing required fields: format, data, headers, filename" },
				{ status: 400 },
			);
		}

		if (body.format !== "csv" && body.format !== "excel") {
			return NextResponse.json(
				{ error: "Invalid format. Must be 'csv' or 'excel'" },
				{ status: 400 },
			);
		}

		if (!Array.isArray(body.data) || !Array.isArray(body.headers)) {
			return NextResponse.json({ error: "Data and headers must be arrays" }, { status: 400 });
		}

		// Generate export based on format
		if (body.format === "csv") {
			const csv = generateCsv(body.data, body.headers);
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

			return new NextResponse(blob, {
				status: 200,
				headers: {
					"Content-Type": "text/csv;charset=utf-8;",
					"Content-Disposition": `attachment; filename="${body.filename}.csv"`,
				},
			});
		}

		if (body.format === "excel") {
			const buffer = await generateExcelBuffer(body.data, body.headers, "Data");

			return new NextResponse(buffer, {
				status: 200,
				headers: {
					"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"Content-Disposition": `attachment; filename="${body.filename}.xlsx"`,
				},
			});
		}

		return NextResponse.json({ error: "Invalid export format" }, { status: 400 });
	} catch (error) {
		console.error("Export API error:", error);
		return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
	}
}
