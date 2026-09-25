import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";
import { HistoricalRepairNotAuthorizedError } from "@/lib/time-tracking/historical-gap-repair-executor";
import type { RequestedRepairChange } from "@/lib/time-tracking/historical-repair-proposal";
import {
	applyHistoricalWorkProposal,
	approveHistoricalWorkProposal,
	createAppendContinuationProposal,
	createHistoricalRepairProposal,
	HistoricalProposalConflictError,
	HistoricalProposalNotFoundError,
	HistoricalProposalRefusedError,
	rejectHistoricalWorkProposal,
} from "@/lib/time-tracking/historical-work-proposals";

const MAX_TEXT_LENGTH = 1000;
const MAX_CHANGES = 9;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const TARGETS = new Set(["time_record", "work_period"]);

type ProposalRequest =
	| {
			action: "propose_repair";
			proposalId: string;
			workPeriodId: string;
			changes: RequestedRepairChange[];
			evidenceNote: string;
			reason: string;
	  }
	| {
			action: "propose_continuation";
			proposalId: string;
			employeeId: string;
			anchor: { entryId: string; hash: string };
			reason: string;
	  }
	| { action: "approve"; proposalId: string; fingerprint: string }
	| { action: "reject"; proposalId: string; note: string }
	| { action: "apply"; proposalId: string };

function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT_LENGTH) {
		throw new RequestError(`${name} is required (at most ${MAX_TEXT_LENGTH} characters)`);
	}
	return value.trim();
}

function uuid(value: unknown, name: string): string {
	if (typeof value !== "string" || !UUID.test(value))
		throw new RequestError(`${name} must be a UUID`);
	return value.toLowerCase();
}

class RequestError extends Error {}

/** Shapes only; which field each representation may change is the proposal's rule. */
function parseChanges(value: unknown): RequestedRepairChange[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES) {
		throw new RequestError(`changes must list 1 to ${MAX_CHANGES} changes`);
	}
	return value.map((item) => {
		const change = item as Record<string, unknown> | null;
		const target = change?.target;
		const field = change?.field;
		const after = change?.after;
		if (typeof target !== "string" || !TARGETS.has(target) || typeof field !== "string") {
			throw new RequestError("each change needs a target and a field");
		}
		const numeric = field === "duration_minutes";
		if (numeric ? typeof after !== "number" : typeof after !== "string" || after.length > 100) {
			throw new RequestError(`${field} needs a ${numeric ? "number" : "string"} value`);
		}
		return { target, field, after } as RequestedRepairChange;
	});
}

function parseRequest(body: unknown): ProposalRequest {
	if (typeof body !== "object" || body === null)
		throw new RequestError("Request body must be an object");
	const input = body as Record<string, unknown>;
	switch (input.action) {
		case "propose_repair":
			return {
				action: "propose_repair",
				proposalId: uuid(input.proposalId, "proposalId"),
				workPeriodId: uuid(input.workPeriodId, "workPeriodId"),
				changes: parseChanges(input.changes),
				evidenceNote: text(input.evidenceNote, "evidenceNote"),
				reason: text(input.reason, "reason"),
			};
		case "propose_continuation": {
			if (typeof input.anchorHash !== "string" || input.anchorHash.length > 200) {
				throw new RequestError("anchorHash is required");
			}
			return {
				action: "propose_continuation",
				proposalId: uuid(input.proposalId, "proposalId"),
				employeeId: uuid(input.employeeId, "employeeId"),
				anchor: { entryId: uuid(input.anchorEntryId, "anchorEntryId"), hash: input.anchorHash },
				reason: text(input.reason, "reason"),
			};
		}
		case "approve":
			if (typeof input.fingerprint !== "string" || !FINGERPRINT.test(input.fingerprint)) {
				throw new RequestError("fingerprint must name the reviewed proposal");
			}
			return {
				action: "approve",
				proposalId: uuid(input.proposalId, "proposalId"),
				fingerprint: input.fingerprint,
			};
		case "reject":
			return {
				action: "reject",
				proposalId: uuid(input.proposalId, "proposalId"),
				note: text(input.note, "note"),
			};
		case "apply":
			return { action: "apply", proposalId: uuid(input.proposalId, "proposalId") };
		default:
			throw new RequestError(
				"action must be propose_repair, propose_continuation, approve, reject or apply",
			);
	}
}

/**
 * POST /api/time-entries/diagnostics/proposals
 * Separately authorized explicit historical proposals (#323): exact field repairs of
 * one work and append continuations from one existing anchor. Creating, approving and
 * rejecting write only the proposal; `apply` needs the organization's separate repair
 * authorization and revalidates the approved proposal under the employee's writer
 * coordination. Organization administrators only.
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const organizationId = session.session?.activeOrganizationId;
		if (!organizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: organizationId,
		});
		const ability = await getAbility();
		if (!ability?.can("manage", "OrgSettings")) {
			const httpError = toHttpError(new ForbiddenError("manage", "OrgSettings"));
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const parsed = parseRequest(await request.json().catch(() => null));
		const actor = { organizationId, actorUserId: session.user.id };

		switch (parsed.action) {
			case "propose_repair": {
				const proposal = await createHistoricalRepairProposal(db, {
					...actor,
					proposalId: parsed.proposalId,
					reason: parsed.reason,
					request: {
						workPeriodId: parsed.workPeriodId,
						changes: parsed.changes,
						evidenceNote: parsed.evidenceNote,
					},
				});
				return NextResponse.json({ status: "proposed", proposal });
			}
			case "propose_continuation": {
				const [owner] = await db
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(eq(employee.organizationId, organizationId), eq(employee.id, parsed.employeeId)),
					)
					.limit(1);
				if (!owner) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
				const proposal = await createAppendContinuationProposal(db, {
					...actor,
					proposalId: parsed.proposalId,
					reason: parsed.reason,
					employeeId: parsed.employeeId,
					anchor: parsed.anchor,
				});
				return NextResponse.json({ status: "proposed", proposal });
			}
			case "approve":
				return NextResponse.json(
					await approveHistoricalWorkProposal(db, {
						...actor,
						proposalId: parsed.proposalId,
						fingerprint: parsed.fingerprint,
					}),
				);
			case "reject":
				return NextResponse.json(
					await rejectHistoricalWorkProposal(db, {
						...actor,
						proposalId: parsed.proposalId,
						note: parsed.note,
					}),
				);
			case "apply":
				return NextResponse.json(
					await applyHistoricalWorkProposal(db, { ...actor, proposalId: parsed.proposalId }),
				);
		}
	} catch (error) {
		if (error instanceof RequestError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		if (error instanceof HistoricalProposalNotFoundError) {
			return NextResponse.json({ error: error.message }, { status: 404 });
		}
		if (error instanceof HistoricalProposalRefusedError) {
			return NextResponse.json(
				{ error: error.message, code: "proposal_refused", reasons: error.reasons },
				{ status: 422 },
			);
		}
		if (error instanceof HistoricalProposalConflictError) {
			return NextResponse.json(
				{ error: error.message, code: error.code, status: error.status ?? null },
				{ status: 409 },
			);
		}
		if (error instanceof HistoricalRepairNotAuthorizedError) {
			return NextResponse.json(
				{ error: error.message, code: "repair_not_authorized" },
				{ status: 409 },
			);
		}
		console.error("Error handling historical work proposal:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
