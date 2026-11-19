import { Effect } from "effect";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { loadClockComplianceSnapshot } from "@/lib/compliance/clock-compliance";
import { runServerActionSafe } from "@/lib/effect/result";
import { ComplianceGuardrailServiceLive } from "@/lib/effect/services/compliance-guardrail.service";
import { superJsonResponse } from "@/lib/superjson";

const headers = { "Cache-Control": "private, no-store" };
const inputSchema = z.strictObject({
	mode: z.enum(["idle", "active"]),
	currentSessionMinutes: z.coerce.number().finite().min(0),
});

export async function GET(request: Request) {
	try {
		const parsed = inputSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid compliance query" }, { status: 400, headers });
		}
		const result = await runServerActionSafe(
			loadClockComplianceSnapshot({
				...parsed.data,
				expectedUserId: request.headers.get(ORGANIZATION_CONTEXT_HEADERS.user),
				expectedOrganizationId: request.headers.get(ORGANIZATION_CONTEXT_HEADERS.organization),
			}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
		);
		if (!result.success) {
			const status =
				result.refusal === "context_changed"
					? 409
					: result.code === "AuthenticationError"
						? 401
						: result.code === "AuthorizationError"
							? 403
							: result.code === "NotFoundError"
								? 404
								: 500;
			return NextResponse.json(
				{ error: status === 500 ? "Compliance data could not be loaded" : result.error },
				{ status, headers },
			);
		}
		return superJsonResponse(result.data, { headers });
	} catch (error) {
		unstable_rethrow(error);
		return NextResponse.json(
			{ error: "Compliance data could not be loaded" },
			{ status: 500, headers },
		);
	}
}
