import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/health";

/**
 * GET /api/health
 * Health check endpoint for load balancers, K8s probes, and monitoring
 *
 * Returns:
 * - 200: All services healthy
 * - 503: Critical services (database) unavailable
 *
 * Response includes detailed status for each service with latency metrics
 */
export async function GET() {
	const result = await checkHealth();

	const statusCode = result.status === "unhealthy" ? 503 : 200;

	return NextResponse.json(result, {
		status: statusCode,
		headers: {
			"Cache-Control": "no-store, no-cache, must-revalidate",
		},
	});
}
