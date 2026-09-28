import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { getUserTimezone } from "@/app/[locale]/(app)/time-tracking/actions/auth";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { systemClock } from "@/lib/datetime/temporal-core";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { createLogger } from "@/lib/logger";
import {
	CLOCK_COMMAND_ADMISSION_WINDOWS,
	CLOCK_COMMAND_VERSION,
	checkBreakClockContinuity,
	parseClockCommand,
	verifyClockCommandContext,
} from "@/lib/time-tracking/clock-command";
import { type ClockOutAdvice, clocking } from "@/lib/time-tracking/clocking";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";
import { readAppendAdmission } from "@/lib/time-tracking/work-transaction";
import {
	adapterRejectionReply,
	type FrozenCommandActor,
	lookupQuery,
	refusalReply,
	requireCommandActor,
	toClockingCommand,
} from "./frozen-clock-command";

/**
 * Versioned direct-HTTP clock commands (#275). Additive next to the legacy
 * `POST /api/time-entries`, which keeps its own matching and admission rules.
 *
 * - `GET` advertises the supported command capabilities and the server-derived
 *   context a client captures into each command.
 * - `POST` submits one frozen version 2 command through the Clocking module.
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
		const windowSeconds = (mode: keyof typeof CLOCK_COMMAND_ADMISSION_WINDOWS) => ({
			pastSeconds: CLOCK_COMMAND_ADMISSION_WINDOWS[mode].pastMilliseconds / 1000,
			futureSeconds: CLOCK_COMMAND_ADMISSION_WINDOWS[mode].futureMilliseconds / 1000,
		});
		return NextResponse.json(
			{
				commandVersions: [CLOCK_COMMAND_VERSION],
				kinds: ["clock_in", "clock_out", "break"],
				// Fresh submission stays gated with the organization's completed-work
				// adoption. Lookup and committed replay work in every mode.
				submit: adopted ? "available" : "unavailable",
				lookup: "available",
				admission: { immediate: windowSeconds("immediate"), delayed: windowSeconds("delayed") },
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

function reply({ status, body }: { status: number; body: Record<string, unknown> }) {
	return NextResponse.json(body, { status, headers: noStore });
}

/**
 * `POST` is a frozen clock command adapter over the Clocking module: it parses the
 * command, verifies its captured context and server origin against the
 * authenticated actor, checks break clock continuity, chooses the age window,
 * and runs the command with its frozen bytes. Committed replay, admission and
 * every other rule belong to the module.
 */
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
	const { command } = parsed;
	const { operationId } = command;
	try {
		let actor: FrozenCommandActor;
		try {
			actor = await requireCommandActor(session);
		} catch (error) {
			if (error instanceof ClockingAccessError) {
				return reply(adapterRejectionReply(operationId, { code: "access_denied" }));
			}
			throw error;
		}
		const mismatched = verifyClockCommandContext(command.context, {
			...actor,
			server: await serverOrigin(request),
		});
		if (mismatched.length > 0) {
			return reply(
				adapterRejectionReply(operationId, { code: "context_mismatch", fields: mismatched }),
			);
		}
		// A property of the frozen bytes alone, so no committed command ever failed it.
		const discontinuity = command.kind === "break" ? checkBreakClockContinuity(command) : null;
		if (discontinuity) return reply(adapterRejectionReply(operationId, discontinuity));

		const outcome = await clocking.run(
			toClockingCommand(command, actor, {
				now: systemClock.nowInstant(),
				fallbackZone: await getUserTimezone(actor.userId).catch(() => command.timezone),
			}),
		);
		if (outcome.outcome === "refused") {
			const { failure } = outcome;
			if (failure.code === "unconfirmed" || failure.code === "failed") {
				logger.error({ error: failure.cause, operationId }, "Clock command failed");
			}
			return reply(refusalReply(operationId, failure));
		}
		const committed = await clocking.lookup(lookupQuery(actor, operationId));
		if (committed.outcome !== "committed") {
			throw new Error(`Committed clock command lookup answered ${committed.outcome}`);
		}
		// An executed closure (clock-out or break) carries its follow-ups' advice.
		const closure =
			outcome.outcome === "executed" && command.kind !== "clock_in"
				? (outcome.result as ClockOutAdvice)
				: null;
		return NextResponse.json(
			{
				outcome: outcome.outcome,
				operationId,
				receipt: committed.receipt,
				// Post-commit advice; absent on replay and for starts.
				...(closure
					? {
							clockOut: {
								complianceWarnings: closure.complianceWarnings,
								breakAdjustment: closure.breakAdjustment,
							},
						}
					: {}),
			},
			{ status: outcome.outcome === "executed" ? 201 : 200, headers: noStore },
		);
	} catch (error) {
		logger.error({ error, operationId }, "Clock command failed");
		// The command may or may not have committed: look it up, then resend it unchanged.
		return NextResponse.json(
			{ outcome: "unknown", operationId },
			{ status: 500, headers: noStore },
		);
	}
}
