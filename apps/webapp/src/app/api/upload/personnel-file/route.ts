import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import {
	canManageDocument,
	canUploadOwnDocument,
	isOwnDocument,
	managedCategoriesFor,
	type SickNoteAttachRefusal,
	type SickNoteAuthority,
} from "@/lib/personnel-file/access";
import { loadEmployeeRef } from "@/lib/personnel-file/access-store";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { DEFAULT_VISIBILITY, isDocumentCategory } from "@/lib/personnel-file/document.types";
import { validateDocumentMetadata } from "@/lib/personnel-file/document-rules";
import { recordUploadedPersonnelDocument } from "@/lib/personnel-file/document-upload";
import { notifyDocumentShared, notifyEmployeeUpload } from "@/lib/personnel-file/notifications";
import { loadSickNoteAttachTarget } from "@/lib/personnel-file/sick-note-attach";

const logger = createLogger("PersonnelFileUpload");

const requestSchema = z.object({
	tusFileKey: z.string().min(1),
	employeeId: z.uuid(),
	/** "own": the employee uploads into their own file (#867). */
	source: z.literal("own").optional(),
	/**
	 * Attaches the upload as a sick note to this sick-leave absence of the
	 * employee: with "own" the employee to theirs (#982), otherwise whoever
	 * manages the employee's sick notes (#984).
	 */
	absenceId: z.uuid().optional(),
	fileName: z.string().max(255).optional(),
	metadata: z.object({
		category: z.unknown(),
		title: z.unknown(),
		documentDate: z.unknown(),
		payPeriod: z.unknown().optional(),
		visibility: z.unknown().optional(),
		expiryDate: z.unknown().optional(),
	}),
});

function notFound() {
	return NextResponse.json({ error: "Employee not found" }, { status: 404 });
}

const SICK_NOTE_REFUSALS: Record<
	Exclude<SickNoteAttachRefusal, "not_own" | "not_managed">,
	string
> = {
	setting_off: "Your organization does not let employees attach sick notes.",
	not_sick: "Sick notes can be attached only to sick leave.",
	rejected: "Sick notes cannot be attached to a rejected absence.",
};

const ABSENCE_UNAVAILABLE = "This absence can no longer take a sick note.";

/**
 * Records a finished TUS upload as an employee document in a personnel file
 * (#865). Only actors the personnel file access resolver lets manage the
 * document's category for that employee may upload; everyone else, and
 * everyone while personnel files are off, gets a not-found.
 *
 * With `source: "own"` the employee uploads into their own file (#867): only
 * certificates and other documents, always shared, and the covering officers
 * (or owners and admins) are notified instead of the employee. With an
 * `absenceId` as well, the upload is a sick note attached to that sick-leave
 * absence of theirs (#982): always a shared sick note without expiry date.
 *
 * Without "own", an `absenceId` attaches a sick note to the employee's
 * sick-leave absence on the authority of whoever manages the employee's sick
 * notes (#984): HR-only unless they choose shared, without expiry date.
 * Managers manage nothing here; they attach only while recording an absence.
 */
export async function POST(request: NextRequest) {
	await connection();

	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status === "unauthenticated") {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}
		if (current.status !== "resolved") return notFound();
		const { access } = current;

		const parsed = requestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
		}
		const { tusFileKey, employeeId, fileName, metadata, absenceId } = parsed.data;
		const own = parsed.data.source === "own";
		const authority: SickNoteAuthority = own ? "employee" : "officer";

		const employee = await loadEmployeeRef(db, {
			organizationId: access.organizationId,
			employeeId,
		});
		// Nothing tells someone without access whether the employee exists.
		if (!employee) return notFound();
		if (
			own ? !isOwnDocument(access, employee.id) : managedCategoriesFor(access, employee).size === 0
		)
			return notFound();

		if (absenceId) {
			const target = await loadSickNoteAttachTarget(db, access, absenceId, authority);
			// Someone else's absence, or one the officer does not cover, reads as not
			// found, like another organization's; so does another employee's absence.
			const reason =
				target.kind === "refused"
					? target.reason
					: target.kind === "not_found" || target.absence.employeeId !== employee.id
						? "not_own"
						: null;
			if (reason === "not_own" || reason === "not_managed") {
				return NextResponse.json({ error: "Absence not found" }, { status: 404 });
			}
			if (reason) {
				return NextResponse.json({ error: SICK_NOTE_REFUSALS[reason] }, { status: 403 });
			}
		}

		// A sick note attached to an absence has no expiry date (#982).
		const category = absenceId ? "sick_note" : metadata.category;
		const validated = validateDocumentMetadata({
			...metadata,
			category,
			payPeriod: metadata.payPeriod ?? null,
			expiryDate: absenceId ? null : (metadata.expiryDate ?? null),
			// Employee uploads are always shared; the employee chooses no visibility.
			visibility: own
				? "shared"
				: (metadata.visibility ??
					(isDocumentCategory(category) ? DEFAULT_VISIBILITY[category] : null)),
		});
		if (!validated.ok) {
			return NextResponse.json(
				{ error: validated.message, field: validated.field },
				{ status: 400 },
			);
		}
		// A sick note was checked against its absence above, and is again when recorded.
		if (own && !absenceId) {
			if (!canUploadOwnDocument(access, employee.id, validated.value.category)) {
				return NextResponse.json(
					{ error: "You can upload only certificates and other documents.", field: "category" },
					{ status: 403 },
				);
			}
		} else if (!own && !canManageDocument(access, employee, validated.value.category)) {
			return notFound();
		}

		const finalized = await recordUploadedPersonnelDocument(db, {
			access,
			employeeId: employee.id,
			tusFileKey,
			fileName,
			metadata: validated.value,
			...(own ? { source: "employee" as const } : {}),
			...(absenceId ? { sickNote: { absenceId, authority } } : {}),
		});

		if (finalized.kind === "invalid_file_key") {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}
		if (finalized.kind === "unreadable") {
			return NextResponse.json({ error: finalized.error }, { status: finalized.status });
		}
		if (finalized.kind === "absence_unavailable") {
			return NextResponse.json({ error: ABSENCE_UNAVAILABLE }, { status: 409 });
		}
		if (finalized.kind === "not_pending") {
			return NextResponse.json(
				{ error: "The upload took too long. Please upload the file again." },
				{ status: 409 },
			);
		}

		if (own) {
			await notifyEmployeeUpload(db, {
				organizationId: access.organizationId,
				document: finalized.document,
			});
		} else if (finalized.shareEventId) {
			await notifyDocumentShared(db, {
				organizationId: access.organizationId,
				shareEventId: finalized.shareEventId,
				document: finalized.document,
			});
		}

		return NextResponse.json({ success: true, document: finalized.document });
	} catch (error) {
		logger.error({ error }, "Personnel file upload processing failed");
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
