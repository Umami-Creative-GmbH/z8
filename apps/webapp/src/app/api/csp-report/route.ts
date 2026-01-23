import { NextResponse } from "next/server";
import type { CSPViolationReport } from "@/lib/security";

/**
 * CSP violation report endpoint
 *
 * Browsers send POST requests here when CSP violations occur.
 * In production, you'd typically forward these to a logging service.
 */
export async function POST(request: Request): Promise<Response> {
	try {
		const contentType = request.headers.get("content-type") || "";

		// CSP reports can come as application/csp-report or application/json
		if (
			!contentType.includes("application/csp-report") &&
			!contentType.includes("application/json")
		) {
			return new NextResponse("Invalid content type", { status: 400 });
		}

		const report = (await request.json()) as CSPViolationReport;
		const cspReport = report["csp-report"];

		if (!cspReport) {
			return new NextResponse("Invalid CSP report format", { status: 400 });
		}

		// Log the violation (in production, send to logging service)
		console.warn("[CSP Violation]", {
			documentUri: cspReport["document-uri"],
			violatedDirective: cspReport["violated-directive"],
			blockedUri: cspReport["blocked-uri"],
			sourceFile: cspReport["source-file"],
			lineNumber: cspReport["line-number"],
		});

		// Return 204 No Content (standard response for report endpoints)
		return new NextResponse(null, { status: 204 });
	} catch (error) {
		console.error("[CSP Report Error]", error);
		return new NextResponse("Failed to process report", { status: 500 });
	}
}

// Allow GET for health checks
export async function GET(): Promise<Response> {
	return NextResponse.json({ status: "ok", endpoint: "csp-report" });
}
