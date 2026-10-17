import { db } from "@/db";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import { assertDrivingLicenceRecordAccess } from "@/lib/organization/driving-licence/access";
import { requireDrivingLicenceActor } from "@/lib/organization/driving-licence/context";
import {
	historyQueryInput,
	readDrivingLicenceHistory,
} from "@/lib/organization/driving-licence/history";
import { loadUserNames } from "@/lib/personal-data-export/values";

const privateHeaders = {
	"Cache-Control": "private, no-store, max-age=0",
	"X-Content-Type-Options": "nosniff",
};
/** Regenerated for every request. No public URL, storage object or cached selection can outlive scope. */
export async function GET(request: Request) {
	try {
		const selected = historyQueryInput.parse(
			Object.fromEntries(new URL(request.url).searchParams),
		);
		const input = {
			employeeId: selected.employeeId,
			...(selected.from
				? { from: parseInstant(selected.from).toString() }
				: {}),
			...(selected.to ? { to: parseInstant(selected.to).toString() } : {}),
		};
		const actor = await requireDrivingLicenceActor();
		const history = await readDrivingLicenceHistory(actor, input);
		const { renderDrivingLicenceEvidencePdf } = await import(
			"@/lib/organization/driving-licence/evidence-pdf"
		);
		const actorNames = await loadUserNames(db, [
			...history.events.map((e) => e.actorUserId),
			...history.policies.map((p) => p.changedBy),
		]);
		const bytes = await renderDrivingLicenceEvidencePdf(
			history,
			systemClock.nowInstant().toString(),
			actorNames,
		);
		// Rendering may take time: reauthenticate and resolve current tenant, employment and verifier scope before delivery.
		const current = await requireDrivingLicenceActor();
		if (
			current.organizationId !== actor.organizationId ||
			current.userId !== actor.userId
		)
			throw new Error("unavailable");
		await db.transaction(async (tx) => {
			await assertDrivingLicenceRecordAccess(tx, {
				organizationId: current.organizationId,
				userId: current.userId,
				employeeId: input.employeeId,
				now: systemClock.nowInstant(),
			});
		});
		return new Response(new Uint8Array(bytes), {
			headers: {
				...privateHeaders,
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="driving-licence-evidence-${input.employeeId}.pdf"`,
			},
		});
	} catch {
		return new Response(
			"Driving licence evidence is unavailable. Check your period and current access.",
			{ status: 404, headers: privateHeaders },
		);
	}
}
