import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import {
	type ClockCommandSubmission,
	submitClockCommand,
} from "@/app/[locale]/(app)/time-tracking/actions/clock-command";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { createLogger } from "@/lib/logger";
import {
	CLOCK_COMMAND_ADMISSION_WINDOWS,
	CLOCK_COMMAND_VERSION,
	parseClockCommand,
} from "@/lib/time-tracking/clock-command";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";
import { readAppendAdmission } from "@/lib/time-tracking/work-transaction";

/**
 * Versioned direct-HTTP clock commands (#275). Additive next to the legacy
 * `POST /api/time-entries`, which keeps its own matching and admission rules.
 *
 * - `GET` advertises the supported command capabilities and the server-derived
 *   context a client captures into each command.
 * - `POST` submits one frozen version 2 command.
 * - `GET /api/time-entries/commands/{operationId}` is lookup-only recovery.
 */
const logger = createLogger("ClockCommands");
const noStore = { "Cache-Control": "no-store" };

async function serverOrigin(request: Request): Promise<string | null> {
	try {
		return await resolvePublicRequestOrigin(request);
	} catch {
		return null;
	}
}

export async function GET(request: Request) {
	await connection();
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
	}
	try {
		const actor = await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: session.session.activeOrganizationId,
		});
		const adopted = (await readAppendAdmission(db, actor.organizationId)) === "append";
		const window = (mode: keyof typeof CLOCK_COMMAND_ADMISSION_WINDOWS) => ({
			pastSeconds: CLOCK_COMMAND_ADMISSION_WINDOWS[mode].pastMilliseconds / 1000,
			futureSeconds: CLOCK_COMMAND_ADMISSION_WINDOWS[mode].futureMilliseconds / 1000,
		});
		return NextResponse.json(
			{
				commandVersions: [CLOCK_COMMAND_VERSION],
				kinds: ["clock_in", "clock_out"],
				// Fresh submission stays gated with the organization's completed-work
				// adoption. Lookup and committed replay work in every mode.
				submit: adopted ? "available" : "unavailable",
				lookup: "available",
				admission: { immediate: window("immediate"), delayed: window("delayed") },
				context: {
					userId: actor.userId,
					organizationId: actor.organizationId,
					employeeId: actor.employee.id,
					server: await serverOrigin(request),
				},
			},
			{ headers: noStore },
		);
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403, headers: noStore });
		}
		logger.error({ error }, "Clock command capabilities failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: noStore });
	}
}

const REJECTION_STATUS: Record<
	Extract<ClockCommandSubmission, { outcome: "rejected" }>["code"],
	number
> = {
	access_denied: 403,
	billing_required: 402,
	context_mismatch: 409,
	collision: 409,
	not_adopted: 409,
	target_unknown: 409,
	target_not_active: 409,
	already_clocked_in: 409,
	occupancy_conflict: 409,
	append_review_required: 409,
	admission_window: 422,
	not_allowed_at_time: 422,
	invalid_interval: 422,
	attribution_not_allowed: 422,
	approval_routing: 422,
	approval_policy_unavailable: 503,
};

export async function POST(request: Request) {
	await connection();
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ outcome: "rejected", code: "invalid_command" },
			{ status: 400, headers: noStore },
		);
	}
	const parsed = parseClockCommand(body);
	if (!parsed.ok) {
		return NextResponse.json(
			{ outcome: "rejected", code: parsed.code },
			{ status: parsed.code === "unsupported_version" ? 422 : 400, headers: noStore },
		);
	}
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json(
			{ outcome: "rejected", code: "unauthorized", operationId: parsed.command.operationId },
			{ status: 401, headers: noStore },
		);
	}
	try {
		const submission = await submitClockCommand({
			command: parsed.command,
			session: {
				userId: session.user.id,
				activeOrganizationId: session.session.activeOrganizationId,
			},
			serverOrigin: await serverOrigin(request),
		});
		const status =
			submission.outcome === "rejected"
				? REJECTION_STATUS[submission.code]
				: submission.outcome === "executed"
					? 201
					: 200;
		if (submission.outcome === "rejected" && submission.code === "billing_required") {
			return NextResponse.json(
				{
					outcome: "rejected",
					operationId: submission.operationId,
					code: submission.code,
					reason: submission.billing.reason ?? "subscription_required",
				},
				{ status, headers: noStore },
			);
		}
		return NextResponse.json(submission, { status, headers: noStore });
	} catch (error) {
		logger.error({ error, operationId: parsed.command.operationId }, "Clock command failed");
		// The command may or may not have committed: look it up, then resend it unchanged.
		return NextResponse.json(
			{ outcome: "unknown", operationId: parsed.command.operationId },
			{ status: 500, headers: noStore },
		);
	}
}
