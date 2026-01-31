/**
 * Analytics Export API Route
 *
 * POST endpoint for exporting analytics data as CSV or Excel files.
 * Requires authentication and validates export requests.
 */

import { type NextRequest, NextResponse, connection } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateCsv } from "@/lib/reporting/csv-export";
import { generateExcelBuffer } from "@/lib/reporting/excel-export";

// Validation schema with security constraints
const exportRequestSchema = z.object({
	format: z.enum(["csv", "excel"]),
	data: z
		.array(z.record(z.string(), z.unknown()))
		.max(10000, { message: "Data array cannot exceed 10,000 items" }),
	headers: z
		.array(
			z.object({
				key: z.string().max(100, { message: "Header key cannot exceed 100 characters" }),
				label: z.string().max(200, { message: "Header label cannot exceed 200 characters" }),
			}),
		)
		.max(50, { message: "Headers array cannot exceed 50 items" }),
	filename: z
		.string()
		.max(200, { message: "Filename cannot exceed 200 characters" })
		.regex(/^[a-zA-Z0-9_-]+$/, {
			message: "Filename can only contain letters, numbers, underscores, and hyphens",
		}),
});

type ExportRequestBody = z.infer<typeof exportRequestSchema>;

/**
 * Sanitize data to prevent Excel formula injection.
 * Prefixes strings starting with formula characters with a single quote.
 */
function sanitizeForExcel(data: Record<string, unknown>[]): Record<string, unknown>[] {
	const formulaChars = ["=", "+", "-", "@", "\t", "\r"];

	return data.map((row) => {
		const sanitizedRow: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			if (typeof value === "string" && formulaChars.some((char) => value.startsWith(char))) {
				sanitizedRow[key] = `'${value}`;
			} else {
				sanitizedRow[key] = value;
			}
		}
		return sanitizedRow;
	});
}

export async function POST(request: NextRequest) {
	await connection();
	try {
		// Authentication check
		const session = await auth.api.getSession({
			headers: request.headers,
		});

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Parse and validate request body with Zod schema
		const rawBody = await request.json();
		const parseResult = exportRequestSchema.safeParse(rawBody);

		if (!parseResult.success) {
			const errorMessage = parseResult.error.issues.map((e) => e.message).join(", ");
			return NextResponse.json({ error: errorMessage }, { status: 400 });
		}

		const body = parseResult.data;

		// Sanitize data to prevent Excel formula injection
		const sanitizedData = sanitizeForExcel(body.data);

		// Generate export based on format
		if (body.format === "csv") {
			const csv = generateCsv(sanitizedData, body.headers);
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
			const buffer = await generateExcelBuffer(sanitizedData, body.headers, "Data");

			return new NextResponse(new Uint8Array(buffer), {
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
