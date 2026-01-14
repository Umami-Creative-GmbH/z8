import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { createLogger } from "@/lib/logger";
import {
	calculateTelemetryMetrics,
	getOrCreateDeploymentId,
	sendTelemetryReport,
} from "@/lib/telemetry";

const logger = createLogger("cron-telemetry");

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Verify the request is from a valid cron source
 */
async function verifyCronAuth(request: NextRequest): Promise<boolean> {
	const headersList = await headers();
	const authHeader = headersList.get("authorization");

	if (authHeader === `Bearer ${CRON_SECRET}`) {
		return true;
	}

	const { searchParams } = new URL(request.url);
	const secret = searchParams.get("secret");

	if (secret === CRON_SECRET) {
		return true;
	}

	if (process.env.NODE_ENV === "development") {
		logger.warn("Allowing cron request without auth in development");
		return true;
	}

	return false;
}

/**
 * GET /api/cron/telemetry
 */
export async function GET(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	logger.info("Starting telemetry collection cron job");

	try {
		const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

		if (!telemetryEnabled) {
			logger.info("Telemetry is disabled, skipping collection");
			return NextResponse.json({
				success: false,
				message: "Telemetry disabled",
				timestamp: new Date().toISOString(),
			});
		}

		const deploymentId = await getOrCreateDeploymentId();
		const metrics = await calculateTelemetryMetrics();
		const sendSuccess = await sendTelemetryReport(deploymentId, metrics);

		logger.info(
			{
				deploymentId,
				metrics,
				sendSuccess,
			},
			"Telemetry collection completed",
		);

		return NextResponse.json({
			success: sendSuccess,
			metrics,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		logger.error({ error: err }, "Telemetry cron job failed");

		return NextResponse.json(
			{
				success: false,
				error: err instanceof Error ? err.message : "Unknown error",
				timestamp: new Date().toISOString(),
			},
			{ status: 200 },
		);
	}
}

/**
 * POST /api/cron/telemetry
 */
export async function POST(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	logger.info("Manual telemetry trigger via POST");

	try {
		const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

		if (!telemetryEnabled) {
			logger.info("Telemetry is disabled, skipping collection");
			return NextResponse.json({
				success: false,
				message: "Telemetry disabled",
				timestamp: new Date().toISOString(),
			});
		}

		const deploymentId = await getOrCreateDeploymentId();
		const metrics = await calculateTelemetryMetrics();
		const sendSuccess = await sendTelemetryReport(deploymentId, metrics);

		logger.info(
			{
				deploymentId,
				metrics,
				sendSuccess,
			},
			"Manual telemetry collection completed",
		);

		return NextResponse.json({
			success: sendSuccess,
			metrics,
			timestamp: new Date().toISOString(),
		});
	} catch (err) {
		logger.error({ error: err }, "Manual telemetry trigger failed");

		return NextResponse.json(
			{
				success: false,
				error: err instanceof Error ? err.message : "Unknown error",
				timestamp: new Date().toISOString(),
			},
			{ status: 200 },
		);
	}
}
