import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { getAuditContextFromRequest } from "@/lib/middleware/audit-context";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	planPersonnelFileZip,
	streamPersonnelFileZip,
	writePersonnelFileZipAudit,
} from "@/lib/personnel-file/zip-download";
import { personnelFileZipFileName } from "@/lib/personnel-file/zip-entries";

const logger = createLogger("PersonnelFileZip");
const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};

function notFound() {
	return NextResponse.json(
		{ error: "Personnel file not found" },
		{ status: 404, headers: privateHeaders },
	);
}

function contentDisposition(fileName: string): string {
	const encoded = encodeURIComponent(fileName).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename*=UTF-8''${encoded}`;
}

/**
 * Downloads an employee's personnel file as one ZIP (#871), for current and
 * former employees alike. Only the categories the actor manages for that
 * employee are included; `?sharedOnly=0` adds HR-only documents (shared only
 * is the default). Actors without a grant for the employee, and everyone while
 * personnel files are off, get a not-found. The download is audited once with
 * the included documents, then streamed file by file.
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ employeeId: string }> },
) {
	await connection();
	try {
		const { employeeId } = await params;
		if (!z.uuid().safeParse(employeeId).success) return notFound();
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status === "unauthenticated") {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
		}
		if (current.status !== "resolved") return notFound();
		const { access } = current;
		const sharedOnly = new URL(request.url).searchParams.get("sharedOnly") !== "0";

		const plan = await planPersonnelFileZip(db, access, { employeeId, sharedOnly });
		if (!plan) return notFound();

		const auditContext = getAuditContextFromRequest(request);
		await writePersonnelFileZipAudit(db, {
			actorUserId: access.userId,
			plan,
			ipAddress: auditContext.ipAddress,
			userAgent: auditContext.userAgent,
		});

		return new Response(streamPersonnelFileZip(plan), {
			headers: {
				...privateHeaders,
				"Content-Type": "application/zip",
				"Content-Disposition": contentDisposition(personnelFileZipFileName(plan.employee.name)),
			},
		});
	} catch (error) {
		logger.error({ error }, "Failed to prepare the personnel file download");
		return NextResponse.json(
			{ error: "Personnel file unavailable. Please retry." },
			{ status: 503, headers: privateHeaders },
		);
	}
}
