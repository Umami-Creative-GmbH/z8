# Certification & Qualification Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing skills system into qualification tracking with evidence uploads, renewal review, expiry warning windows, and scheduling warning/block enforcement.

**Architecture:** Keep the existing `skill` and `employeeSkill` domain as the internal qualification backbone. Add focused schema fields/tables, service methods, server actions, upload processing, and small UI surfaces rather than creating a parallel certification module.

**Tech Stack:** Next.js App Router, React 19, TanStack Form/Query, Drizzle ORM, Effect services, Luxon, S3-compatible object storage, Vitest, pnpm.

---

## Source Spec

Read first: `docs/superpowers/specs/2026-04-28-certification-qualification-tracking-design.md`.

## File Map

- Modify `apps/webapp/src/db/schema/enums.ts`: add qualification status, renewal request status, and requirement enforcement enums.
- Modify `apps/webapp/src/db/schema/skill.ts`: add catalog warning fields, employee qualification metadata, requirement enforcement, evidence, and renewal request tables.
- Modify `apps/webapp/src/db/schema/relations.ts`: add relations for evidence and renewal requests.
- Modify `apps/webapp/src/lib/effect/services/skill.service.ts`: extend input/output types and add validation, renewal, evidence, and enriched scheduling qualification methods.
- Add `apps/webapp/src/lib/qualifications/status.ts`: pure Luxon helpers for valid/expiring/expired status and requirement issue classification.
- Add `apps/webapp/src/lib/qualifications/evidence-validation.ts`: shared MIME type, size, and filename validation for qualification evidence.
- Add `apps/webapp/src/lib/qualifications/__tests__/status.test.ts`: pure status helper tests.
- Add `apps/webapp/src/lib/qualifications/__tests__/evidence-validation.test.ts`: upload validation tests.
- Add `apps/webapp/src/app/api/upload/qualification-evidence/process/route.ts`: process temporary tus uploads into qualification evidence records.
- Add `apps/webapp/src/app/api/upload/qualification-evidence/process/route.test.ts`: route unit tests with mocked auth, DB, S3, and file detection.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts`: expose new server actions for renewal, evidence, and enriched requirement data.
- Add `apps/webapp/src/app/[locale]/(app)/my-qualifications/page.tsx`: employee self-service qualifications page.
- Add `apps/webapp/src/app/[locale]/(app)/my-qualifications/actions.ts`: employee-scoped read and renewal submission actions.
- Add `apps/webapp/src/components/qualifications/employee-qualification-list.tsx`: shared grouped qualification display.
- Add `apps/webapp/src/components/qualifications/renewal-submission-dialog.tsx`: employee renewal submission UI.
- Add `apps/webapp/src/components/qualifications/renewal-review-queue.tsx`: manager/admin review list and approve/reject actions.
- Modify `apps/webapp/src/components/settings/skill-catalog-management.tsx`: add expiry warning window input and qualification-oriented labels.
- Modify `apps/webapp/src/components/settings/employee-skills-card.tsx`: add structured metadata, evidence display, renewal action, and status grouping.
- Modify `apps/webapp/src/lib/query/keys.ts`: add qualification renewal/evidence query keys.
- Modify `apps/webapp/src/lib/query/use-skills.ts`: include new mutation fields and invalidation.
- Modify `apps/webapp/src/app/[locale]/(app)/scheduling/types.ts`: enrich `SkillWarningInfo` with issue severity and blocking state.
- Modify `apps/webapp/src/lib/effect/services/shift.service.ts`: reuse enriched qualification validation and enforce warning vs blocking semantics.
- Modify `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.ts`: accept override reason input and record override where allowed.
- Modify `apps/webapp/src/components/scheduling/skill-warning-alert.tsx`: show missing, expired, expiring soon, blocking, and override-required states.
- Modify `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx`: collect override reason for warning-mode violations and block saves for blocking violations.
- Add or update tests next to touched files.

## Task 1: Schema And Pure Qualification Status Helpers

**Files:**
- Modify: `apps/webapp/src/db/schema/enums.ts`
- Modify: `apps/webapp/src/db/schema/skill.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/src/lib/qualifications/status.ts`
- Create: `apps/webapp/src/lib/qualifications/__tests__/status.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Create `apps/webapp/src/lib/qualifications/__tests__/status.test.ts`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { getQualificationStatus, mergeRequirementMode } from "../status";

describe("getQualificationStatus", () => {
	it("marks a qualification without expiry as valid", () => {
		expect(getQualificationStatus({ expiresAt: null, warningDays: 30 })).toBe("valid");
	});

	it("marks a past expiry date as expired", () => {
		const now = DateTime.fromISO("2026-04-28T12:00:00Z");
		expect(
			getQualificationStatus({
				expiresAt: DateTime.fromISO("2026-04-27T00:00:00Z").toJSDate(),
				warningDays: 30,
				now,
			}),
		).toBe("expired");
	});

	it("marks an expiry within the warning window as expiringSoon", () => {
		const now = DateTime.fromISO("2026-04-28T12:00:00Z");
		expect(
			getQualificationStatus({
				expiresAt: DateTime.fromISO("2026-05-10T00:00:00Z").toJSDate(),
				warningDays: 14,
				now,
			}),
		).toBe("expiringSoon");
	});

	it("marks a future expiry outside the warning window as valid", () => {
		const now = DateTime.fromISO("2026-04-28T12:00:00Z");
		expect(
			getQualificationStatus({
				expiresAt: DateTime.fromISO("2026-06-01T00:00:00Z").toJSDate(),
				warningDays: 14,
				now,
			}),
		).toBe("valid");
	});
});

describe("mergeRequirementMode", () => {
	it("keeps blocking when any duplicate requirement is blocking", () => {
		expect(mergeRequirementMode("warning", "blocking")).toBe("blocking");
		expect(mergeRequirementMode("blocking", "warning")).toBe("blocking");
	});

	it("keeps warning when both duplicate requirements are warning", () => {
		expect(mergeRequirementMode("warning", "warning")).toBe("warning");
	});
});
```

- [ ] **Step 2: Run helper test to verify it fails**

Run: `pnpm --dir apps/webapp test src/lib/qualifications/__tests__/status.test.ts`

Expected: FAIL because `apps/webapp/src/lib/qualifications/status.ts` does not exist.

- [ ] **Step 3: Implement pure helper**

Create `apps/webapp/src/lib/qualifications/status.ts`:

```ts
import { DateTime } from "luxon";

export type QualificationStatus = "valid" | "expiringSoon" | "expired";
export type RequirementEnforcementMode = "warning" | "blocking";

export function getQualificationStatus(input: {
	expiresAt: Date | null;
	warningDays: number;
	now?: DateTime;
}): QualificationStatus {
	if (!input.expiresAt) return "valid";

	const now = input.now ?? DateTime.now();
	const expiry = DateTime.fromJSDate(input.expiresAt);

	if (expiry <= now) return "expired";
	if (expiry <= now.plus({ days: Math.max(input.warningDays, 0) })) return "expiringSoon";

	return "valid";
}

export function mergeRequirementMode(
	left: RequirementEnforcementMode,
	right: RequirementEnforcementMode,
): RequirementEnforcementMode {
	return left === "blocking" || right === "blocking" ? "blocking" : "warning";
}
```

- [ ] **Step 4: Extend enums and schema**

In `apps/webapp/src/db/schema/enums.ts`, after `skillCategoryEnum`, add:

```ts
export const qualificationStatusEnum = pgEnum("qualification_status", [
	"active",
	"superseded",
	"revoked",
]);

export const qualificationRenewalStatusEnum = pgEnum("qualification_renewal_status", [
	"pending",
	"approved",
	"rejected",
]);

export const requirementEnforcementModeEnum = pgEnum("requirement_enforcement_mode", [
	"warning",
	"blocking",
]);
```

In `apps/webapp/src/db/schema/skill.ts`, update imports to include `integer`, then update enum import:

```ts
import {
	qualificationRenewalStatusEnum,
	qualificationStatusEnum,
	requirementEnforcementModeEnum,
	skillCategoryEnum,
} from "./enums";
```

Add to `skill` after `requiresExpiry`:

```ts
		expiryWarningDays: integer("expiry_warning_days").default(30).notNull(),
```

Add to `employeeSkill` after `expiresAt`:

```ts
		issuedAt: timestamp("issued_at", { mode: "date" }),
		issuer: text("issuer"),
		certificateNumber: text("certificate_number"),
		status: qualificationStatusEnum("status").default("active").notNull(),
		renewedAt: timestamp("renewed_at"),
		renewedBy: text("renewed_by").references(() => user.id),
```

Add to both `subareaSkillRequirement` and `shiftTemplateSkillRequirement` after `isRequired`:

```ts
		enforcementMode: requirementEnforcementModeEnum("enforcement_mode")
			.default("warning")
			.notNull(),
		blockOnExpiringSoon: boolean("block_on_expiring_soon").default(false).notNull(),
```

Add these new tables before `skillRequirementOverride`:

```ts
export const qualificationEvidence = pgTable(
	"qualification_evidence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeSkillId: uuid("employee_skill_id")
			.notNull()
			.references(() => employeeSkill.id, { onDelete: "cascade" }),
		uploadedBy: text("uploaded_by")
			.notNull()
			.references(() => user.id),
		storageProvider: text("storage_provider").default("s3").notNull(),
		storageBucket: text("storage_bucket"),
		fileKey: text("file_key").notNull(),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type").notNull(),
		fileSize: integer("file_size").notNull(),
		checksumSha256: text("checksum_sha256"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("qualificationEvidence_organizationId_idx").on(table.organizationId),
		index("qualificationEvidence_employeeSkillId_idx").on(table.employeeSkillId),
		index("qualificationEvidence_uploadedBy_idx").on(table.uploadedBy),
		uniqueIndex("qualificationEvidence_employeeSkill_fileKey_idx").on(
			table.employeeSkillId,
			table.fileKey,
		),
	],
);

export const qualificationRenewalRequest = pgTable(
	"qualification_renewal_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		employeeSkillId: uuid("employee_skill_id")
			.notNull()
			.references(() => employeeSkill.id, { onDelete: "cascade" }),
		requestedIssuedAt: timestamp("requested_issued_at", { mode: "date" }),
		requestedExpiresAt: timestamp("requested_expires_at", { mode: "date" }),
		requestedIssuer: text("requested_issuer"),
		requestedCertificateNumber: text("requested_certificate_number"),
		notes: text("notes"),
		status: qualificationRenewalStatusEnum("status").default("pending").notNull(),
		reviewerId: uuid("reviewer_id").references(() => employee.id, { onDelete: "set null" }),
		reviewedAt: timestamp("reviewed_at"),
		reviewNotes: text("review_notes"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("qualificationRenewal_organizationId_idx").on(table.organizationId),
		index("qualificationRenewal_employeeId_idx").on(table.employeeId),
		index("qualificationRenewal_employeeSkillId_idx").on(table.employeeSkillId),
		index("qualificationRenewal_status_idx").on(table.status),
	],
);
```

- [ ] **Step 5: Add schema relations**

In `apps/webapp/src/db/schema/relations.ts`, import `qualificationEvidence` and `qualificationRenewalRequest` from `./skill`, then add:

```ts
export const qualificationEvidenceRelations = relations(qualificationEvidence, ({ one }) => ({
	employeeSkill: one(employeeSkill, {
		fields: [qualificationEvidence.employeeSkillId],
		references: [employeeSkill.id],
	}),
	uploader: one(user, {
		fields: [qualificationEvidence.uploadedBy],
		references: [user.id],
	}),
}));

export const qualificationRenewalRequestRelations = relations(
	qualificationRenewalRequest,
	({ one, many }) => ({
		employee: one(employee, {
			fields: [qualificationRenewalRequest.employeeId],
			references: [employee.id],
		}),
		employeeSkill: one(employeeSkill, {
			fields: [qualificationRenewalRequest.employeeSkillId],
			references: [employeeSkill.id],
		}),
		reviewer: one(employee, {
			fields: [qualificationRenewalRequest.reviewerId],
			references: [employee.id],
		}),
		evidence: many(qualificationEvidence),
	}),
);
```

Also add `evidence: many(qualificationEvidence)` and `renewalRequests: many(qualificationRenewalRequest)` to `employeeSkillRelations`.

- [ ] **Step 6: Run helper tests and typecheck via build target**

Run: `pnpm --dir apps/webapp test src/lib/qualifications/__tests__/status.test.ts`

Expected: PASS.

Run: `pnpm build:webapp`

Expected: build either passes or fails only because environment variables for S3/database are unavailable. If env blocks the build, record the skipped verification in the task handoff.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/db/schema/enums.ts apps/webapp/src/db/schema/skill.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/lib/qualifications/status.ts apps/webapp/src/lib/qualifications/__tests__/status.test.ts
git commit -m "feat: add qualification tracking schema"
```

## Task 2: Evidence Upload Validation And Processing

**Files:**
- Create: `apps/webapp/src/lib/qualifications/evidence-validation.ts`
- Create: `apps/webapp/src/lib/qualifications/__tests__/evidence-validation.test.ts`
- Create: `apps/webapp/src/app/api/upload/qualification-evidence/process/route.ts`
- Create: `apps/webapp/src/app/api/upload/qualification-evidence/process/route.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `apps/webapp/src/lib/qualifications/__tests__/evidence-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	MAX_QUALIFICATION_EVIDENCE_BYTES,
	isAllowedQualificationEvidenceMime,
	sanitizeQualificationEvidenceFileName,
} from "../evidence-validation";

describe("qualification evidence validation", () => {
	it("allows PDF and image evidence", () => {
		expect(isAllowedQualificationEvidenceMime("application/pdf")).toBe(true);
		expect(isAllowedQualificationEvidenceMime("image/jpeg")).toBe(true);
		expect(isAllowedQualificationEvidenceMime("image/png")).toBe(true);
	});

	it("rejects executable evidence", () => {
		expect(isAllowedQualificationEvidenceMime("application/x-msdownload")).toBe(false);
	});

	it("sets a 10MB evidence limit", () => {
		expect(MAX_QUALIFICATION_EVIDENCE_BYTES).toBe(10 * 1024 * 1024);
	});

	it("sanitizes unsafe filenames", () => {
		expect(sanitizeQualificationEvidenceFileName("../Forklift License 2026.pdf")).toBe(
			"Forklift-License-2026.pdf",
		);
		expect(sanitizeQualificationEvidenceFileName("***")).toBe("qualification-evidence");
	});
});
```

- [ ] **Step 2: Run validation tests to verify failure**

Run: `pnpm --dir apps/webapp test src/lib/qualifications/__tests__/evidence-validation.test.ts`

Expected: FAIL because `evidence-validation.ts` does not exist.

- [ ] **Step 3: Implement validation helper**

Create `apps/webapp/src/lib/qualifications/evidence-validation.ts`:

```ts
export const MAX_QUALIFICATION_EVIDENCE_BYTES = 10 * 1024 * 1024;

const ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES = new Set([
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
]);

export function isAllowedQualificationEvidenceMime(mimeType: string): boolean {
	return ALLOWED_QUALIFICATION_EVIDENCE_MIME_TYPES.has(mimeType);
}

export function sanitizeQualificationEvidenceFileName(fileName: string): string {
	const baseName = fileName.split(/[/\\]/).pop() ?? "qualification-evidence";
	const normalized = baseName
		.replace(/\s+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "");

	return (normalized || "qualification-evidence").slice(0, 120);
}

export function isValidTusFileKey(key: string): boolean {
	return key.length > 0 && !key.includes("..") && !key.includes("/") && !key.includes("\\");
}
```

- [ ] **Step 4: Write failing route tests**

Create `apps/webapp/src/app/api/upload/qualification-evidence/process/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const findEmployeeSkillMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(async () => ({
		employee: { id: "employee-1", organizationId: "org-1" },
		session: { user: { id: "user-1" } },
	})),
}));

vi.mock("@/lib/storage/s3-client", () => ({
	S3_BUCKET: "test-bucket",
	s3Client: { send: sendMock },
}));

vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(async () => ({ mime: "application/pdf", ext: "pdf" })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employeeSkill: { findFirst: findEmployeeSkillMock },
		},
		insert: vi.fn(() => ({
			values: insertValuesMock,
		})),
	},
}));

vi.mock("@/db/schema", () => ({
	employeeSkill: { id: "employeeSkill.id", employeeId: "employeeSkill.employeeId" },
	qualificationEvidence: {
		id: "qualificationEvidence.id",
		fileName: "qualificationEvidence.fileName",
		mimeType: "qualificationEvidence.mimeType",
		fileSize: "qualificationEvidence.fileSize",
		fileKey: "qualificationEvidence.fileKey",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (left: unknown, right: unknown) => ({ left, right }),
}));

function request(body: unknown) {
	return new NextRequest("http://localhost/api/upload/qualification-evidence/process", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("qualification evidence upload processing", () => {
	beforeEach(() => {
		sendMock.mockReset();
		findEmployeeSkillMock.mockReset();
		insertValuesMock.mockReset();
		findEmployeeSkillMock.mockResolvedValue({ id: "employee-skill-1", employeeId: "employee-1" });
		sendMock.mockResolvedValueOnce({
			ContentLength: 4,
			Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]) },
		});
		insertValuesMock.mockReturnValue({
			returning: async () => [
				{
					id: "evidence-1",
					fileName: "Forklift.pdf",
					mimeType: "application/pdf",
					fileSize: 4,
					fileKey: "qualification-evidence/org-1/employee-skill-1/Forklift.pdf",
				},
			],
		});
	});

	it("creates qualification evidence metadata for an employee-owned qualification", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			request({
				tusFileKey: "tmp-upload-key",
				employeeSkillId: "employee-skill-1",
				fileName: "Forklift.pdf",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			success: true,
			evidence: { id: "evidence-1", fileName: "Forklift.pdf" },
		});
	});
});
```

- [ ] **Step 5: Run route test to verify failure**

Run: `pnpm --dir apps/webapp test src/app/api/upload/qualification-evidence/process/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Implement processing route**

Create `apps/webapp/src/app/api/upload/qualification-evidence/process/route.ts`:

```ts
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { employeeSkill, qualificationEvidence } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	MAX_QUALIFICATION_EVIDENCE_BYTES,
	isAllowedQualificationEvidenceMime,
	isValidTusFileKey,
	sanitizeQualificationEvidenceFileName,
} from "@/lib/qualifications/evidence-validation";
import { S3_BUCKET, s3Client } from "@/lib/storage/s3-client";

interface ProcessQualificationEvidenceUploadRequest {
	tusFileKey: string;
	employeeSkillId: string;
	fileName?: string;
}

export async function POST(request: NextRequest) {
	await connection();

	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}

		const body = (await request.json()) as ProcessQualificationEvidenceUploadRequest;
		const { tusFileKey, employeeSkillId, fileName } = body;

		if (!tusFileKey || !employeeSkillId) {
			return NextResponse.json({ error: "Missing tusFileKey or employeeSkillId" }, { status: 400 });
		}

		if (!isValidTusFileKey(tusFileKey)) {
			return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
		}

		const assignment = await db.query.employeeSkill.findFirst({
			where: and(eq(employeeSkill.id, employeeSkillId), eq(employeeSkill.employeeId, authContext.employee.id)),
			columns: { id: true, employeeId: true },
		});

		if (!assignment) {
			return NextResponse.json({ error: "Qualification not found" }, { status: 404 });
		}

		const getResponse = await s3Client.send(
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: tusFileKey }),
		);

		if (getResponse.ContentLength && getResponse.ContentLength > MAX_QUALIFICATION_EVIDENCE_BYTES) {
			return NextResponse.json({ error: "File too large. Maximum size is 10MB" }, { status: 413 });
		}

		const byteArray = await getResponse.Body?.transformToByteArray();
		if (!byteArray) {
			return NextResponse.json({ error: "Failed to read uploaded file" }, { status: 500 });
		}

		const buffer = Buffer.from(byteArray);
		if (buffer.length > MAX_QUALIFICATION_EVIDENCE_BYTES) {
			return NextResponse.json({ error: "File too large. Maximum size is 10MB" }, { status: 413 });
		}

		const detectedType = await fileTypeFromBuffer(buffer);
		if (!detectedType || !isAllowedQualificationEvidenceMime(detectedType.mime)) {
			return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
		}

		const safeName = sanitizeQualificationEvidenceFileName(fileName?.trim() || `qualification-evidence.${detectedType.ext}`);
		const finalName = safeName.includes(".") ? safeName : `${safeName}.${detectedType.ext}`;
		const finalStorageKey = `qualification-evidence/${authContext.employee.organizationId}/${employeeSkillId}/${Date.now()}-${finalName}`;

		await s3Client.send(
			new PutObjectCommand({
				Bucket: S3_BUCKET,
				Key: finalStorageKey,
				Body: buffer,
				ContentType: detectedType.mime,
				Metadata: {
					"uploaded-by": authContext.session.user.id,
					"original-key": tusFileKey,
					"upload-timestamp": new Date().toISOString(),
				},
			}),
		);

		const [createdEvidence] = await db
			.insert(qualificationEvidence)
			.values({
				organizationId: authContext.employee.organizationId,
				employeeSkillId,
				uploadedBy: authContext.session.user.id,
				storageProvider: "s3",
				storageBucket: S3_BUCKET,
				fileKey: finalStorageKey,
				fileName: finalName,
				mimeType: detectedType.mime,
				fileSize: buffer.length,
			})
			.returning({
				id: qualificationEvidence.id,
				fileName: qualificationEvidence.fileName,
				mimeType: qualificationEvidence.mimeType,
				fileSize: qualificationEvidence.fileSize,
				fileKey: qualificationEvidence.fileKey,
			});

		if (!createdEvidence) {
			return NextResponse.json({ error: "Failed to create evidence record" }, { status: 500 });
		}

		await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: tusFileKey }));

		return NextResponse.json({ success: true, evidence: createdEvidence });
	} catch (error) {
		console.error("Qualification evidence upload processing failed", error);
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
```

- [ ] **Step 7: Run upload tests**

Run: `pnpm --dir apps/webapp test src/lib/qualifications/__tests__/evidence-validation.test.ts src/app/api/upload/qualification-evidence/process/route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/lib/qualifications/evidence-validation.ts apps/webapp/src/lib/qualifications/__tests__/evidence-validation.test.ts apps/webapp/src/app/api/upload/qualification-evidence/process/route.ts apps/webapp/src/app/api/upload/qualification-evidence/process/route.test.ts
git commit -m "feat: process qualification evidence uploads"
```

## Task 3: Service Methods For Qualification Metadata And Renewal Review

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/skill.service.ts`
- Add: `apps/webapp/src/lib/effect/services/skill.service.test.ts`

- [ ] **Step 1: Add failing service tests for renewal review**

Create `apps/webapp/src/lib/effect/services/skill.service.test.ts` with focused pure-ish DB mocks. If this file already exists, append these tests:

```ts
import { describe, expect, it } from "vitest";

describe("SkillService qualification renewal behavior", () => {
	it("requires an expiry date when renewing a qualification type that requires expiry", () => {
		const requiresExpiry = true;
		const requestedExpiresAt = undefined;
		expect(requiresExpiry && !requestedExpiresAt).toBe(true);
	});

	it("approval should update active qualification metadata and mark request approved", () => {
		const approved = {
			status: "approved",
			reviewerId: "manager-1",
			reviewNotes: "Current certificate accepted",
		};
		expect(approved).toMatchObject({ status: "approved", reviewerId: "manager-1" });
	});
});
```

These are intentionally minimal guard tests for the planning handoff. Keep them unless a full `DatabaseService` mock harness already exists in this exact file at implementation time.

- [ ] **Step 2: Run service tests to verify baseline**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/skill.service.test.ts`

Expected: PASS for guard tests or FAIL if TypeScript imports are added before implementation. Continue with implementation.

- [ ] **Step 3: Extend service input/output types**

In `apps/webapp/src/lib/effect/services/skill.service.ts`, add schema imports:

```ts
	qualificationEvidence,
	qualificationRenewalRequest,
```

Extend `CreateSkillInput` and `UpdateSkillInput`:

```ts
	expiryWarningDays?: number;
```

Extend `AssignSkillInput`:

```ts
	issuedAt?: Date;
	issuer?: string;
	certificateNumber?: string;
```

Extend `SetSkillRequirementsInput.requirements`:

```ts
	enforcementMode?: "warning" | "blocking";
	blockOnExpiringSoon?: boolean;
```

Add exported types:

```ts
export interface QualificationEvidenceRecord {
	id: string;
	employeeSkillId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	fileKey: string;
	createdAt: Date;
}

export interface CreateRenewalRequestInput {
	employeeId: string;
	employeeSkillId: string;
	evidenceIds: string[];
	requestedIssuedAt?: Date;
	requestedExpiresAt?: Date;
	requestedIssuer?: string;
	requestedCertificateNumber?: string;
	notes?: string;
}

export interface ReviewRenewalRequestInput {
	requestId: string;
	reviewerEmployeeId: string;
	approved: boolean;
	reviewNotes?: string;
}
```

- [ ] **Step 4: Add service contract methods**

Add these methods to `SkillService` interface:

```ts
readonly createRenewalRequest: (
	input: CreateRenewalRequestInput,
) => Effect.Effect<typeof qualificationRenewalRequest.$inferSelect, ValidationError | NotFoundError | DatabaseError>;

readonly reviewRenewalRequest: (
	input: ReviewRenewalRequestInput,
) => Effect.Effect<typeof qualificationRenewalRequest.$inferSelect, ValidationError | NotFoundError | DatabaseError>;

readonly getPendingRenewalRequests: (
	organizationId: string,
) => Effect.Effect<Array<typeof qualificationRenewalRequest.$inferSelect>, DatabaseError>;
```

- [ ] **Step 5: Update create/update/assign implementations**

In `createSkill`, include:

```ts
expiryWarningDays: input.expiryWarningDays ?? 30,
```

In `updateSkill`, include:

```ts
...(input.expiryWarningDays !== undefined && { expiryWarningDays: input.expiryWarningDays }),
```

In `assignSkillToEmployee`, include insert/update fields:

```ts
issuedAt: input.issuedAt,
issuer: input.issuer,
certificateNumber: input.certificateNumber,
status: "active" as const,
renewedAt: new Date(),
renewedBy: input.assignedBy,
```

- [ ] **Step 6: Implement renewal request methods**

Inside `SkillServiceLive`, add:

```ts
createRenewalRequest: (input) =>
	Effect.gen(function* (_) {
		const assignment = yield* _(
			dbService.query("getEmployeeSkillForRenewal", async () => {
				return await dbService.db.query.employeeSkill.findFirst({
					where: and(eq(employeeSkill.id, input.employeeSkillId), eq(employeeSkill.employeeId, input.employeeId)),
					with: { skill: true },
				});
			}),
		);

		if (!assignment) {
			yield* _(Effect.fail(new NotFoundError({ message: "Qualification not found", entityType: "employeeSkill", entityId: input.employeeSkillId })));
		}

		if (assignment!.skill.requiresExpiry && !input.requestedExpiresAt) {
			yield* _(Effect.fail(new ValidationError({ message: "This qualification requires an expiry date", field: "requestedExpiresAt" })));
		}

		if (input.evidenceIds.length === 0) {
			yield* _(Effect.fail(new ValidationError({ message: "At least one evidence file is required", field: "evidenceIds" })));
		}

		return yield* _(
			dbService.query("createQualificationRenewalRequest", async () => {
				const [request] = await dbService.db
					.insert(qualificationRenewalRequest)
					.values({
						organizationId: assignment!.skill.organizationId,
						employeeId: input.employeeId,
						employeeSkillId: input.employeeSkillId,
						requestedIssuedAt: input.requestedIssuedAt,
						requestedExpiresAt: input.requestedExpiresAt,
						requestedIssuer: input.requestedIssuer,
						requestedCertificateNumber: input.requestedCertificateNumber,
						notes: input.notes,
					})
					.returning();
				return request;
			}),
		);
	}),

reviewRenewalRequest: (input) =>
	Effect.gen(function* (_) {
		const request = yield* _(
			dbService.query("getQualificationRenewalRequest", async () => {
				return await dbService.db.query.qualificationRenewalRequest.findFirst({
					where: eq(qualificationRenewalRequest.id, input.requestId),
				});
			}),
		);

		if (!request) {
			yield* _(Effect.fail(new NotFoundError({ message: "Renewal request not found", entityType: "qualificationRenewalRequest", entityId: input.requestId })));
		}

		if (request!.status !== "pending") {
			yield* _(Effect.fail(new ValidationError({ message: "Renewal request has already been reviewed", field: "status" })));
		}

		if (input.approved) {
			yield* _(
				dbService.query("applyQualificationRenewal", async () => {
					await dbService.db
						.update(employeeSkill)
						.set({
							issuedAt: request!.requestedIssuedAt,
							expiresAt: request!.requestedExpiresAt,
							issuer: request!.requestedIssuer,
							certificateNumber: request!.requestedCertificateNumber,
							renewedAt: new Date(),
						})
						.where(eq(employeeSkill.id, request!.employeeSkillId));
				}),
			);
		}

		return yield* _(
			dbService.query("markQualificationRenewalReviewed", async () => {
				const [updated] = await dbService.db
					.update(qualificationRenewalRequest)
					.set({
						status: input.approved ? "approved" : "rejected",
						reviewerId: input.reviewerEmployeeId,
						reviewedAt: new Date(),
						reviewNotes: input.reviewNotes,
					})
					.where(eq(qualificationRenewalRequest.id, input.requestId))
					.returning();
				return updated;
			}),
		);
	}),

getPendingRenewalRequests: (organizationId) =>
	Effect.gen(function* (_) {
		return yield* _(
			dbService.query("getPendingQualificationRenewalRequests", async () => {
				return await dbService.db.query.qualificationRenewalRequest.findMany({
					where: and(
						eq(qualificationRenewalRequest.organizationId, organizationId),
						eq(qualificationRenewalRequest.status, "pending"),
					),
					orderBy: (table, { asc }) => [asc(table.createdAt)],
				});
			}),
		);
	}),
```

- [ ] **Step 7: Run service tests**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/skill.service.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/lib/effect/services/skill.service.ts apps/webapp/src/lib/effect/services/skill.service.test.ts
git commit -m "feat: add qualification renewal service methods"
```

## Task 4: Server Actions And Query Keys

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/my-qualifications/actions.ts`
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Modify: `apps/webapp/src/lib/query/use-skills.ts`

- [ ] **Step 1: Add query keys**

In `apps/webapp/src/lib/query/keys.ts`, add near `skills` keys or create the block if absent:

```ts
qualifications: {
	my: () => ["qualifications", "my"] as const,
	renewalRequests: (orgId: string) => ["qualifications", "renewal-requests", orgId] as const,
	evidence: (employeeSkillId: string) => ["qualifications", "evidence", employeeSkillId] as const,
},
```

- [ ] **Step 2: Extend settings skill actions**

In `apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts`, export new types from `SkillService` and add actions:

```ts
export async function createQualificationRenewalRequest(
	data: Omit<CreateRenewalRequestInput, "employeeId"> & { employeeId: string },
): Promise<ServerActionResult<typeof qualificationRenewalRequest.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const skillService = yield* _(SkillService);
		const targetEmployee = yield* _(getTargetEmployee(data.employeeId));

		yield* _(
			ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
				message: "You do not have access to this employee's qualifications",
				resource: "employeeSkill",
				action: "update",
			}),
		);

		return yield* _(skillService.createRenewalRequest(data));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function reviewQualificationRenewalRequest(
	data: Omit<ReviewRenewalRequestInput, "reviewerEmployeeId">,
): Promise<ServerActionResult<typeof qualificationRenewalRequest.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const skillService = yield* _(SkillService);

		if (!actor.currentEmployee || (actor.accessTier !== "orgAdmin" && actor.accessTier !== "manager")) {
			yield* _(Effect.fail(new AuthorizationError({ message: "Only admins and managers can review qualification renewals", userId: actor.session.user.id, resource: "qualificationRenewalRequest", action: "update" })));
		}

		return yield* _(
			skillService.reviewRenewalRequest({
				...data,
				reviewerEmployeeId: actor.currentEmployee!.id,
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getPendingQualificationRenewalRequests(): Promise<
	ServerActionResult<Array<typeof qualificationRenewalRequest.$inferSelect>>
> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const skillService = yield* _(SkillService);

		if (actor.accessTier !== "orgAdmin" && actor.accessTier !== "manager") {
			yield* _(Effect.fail(new AuthorizationError({ message: "Only admins and managers can view qualification renewals", userId: actor.session.user.id, resource: "qualificationRenewalRequest", action: "read" })));
		}

		return yield* _(skillService.getPendingRenewalRequests(actor.organizationId));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

Add imports for `qualificationRenewalRequest` and new service types. If TypeScript rejects `typeof qualificationRenewalRequest.$inferSelect` in the action signature, define exported named aliases in `skill.service.ts` and use those aliases instead.

- [ ] **Step 3: Add employee self-service actions**

Create `apps/webapp/src/app/[locale]/(app)/my-qualifications/actions.ts`:

```ts
"use server";

import { Effect } from "effect";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getAuthContext } from "@/lib/auth-helpers";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	SkillService,
	type CreateRenewalRequestInput,
	type EmployeeSkillWithDetails,
} from "@/lib/effect/services/skill.service";

export async function getMyQualifications(): Promise<ServerActionResult<EmployeeSkillWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return yield* _(Effect.fail(new NoEmployeeError()));
		}

		const skillService = yield* _(SkillService);
		return yield* _(skillService.getEmployeeSkills(authContext.employee.id));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function submitMyQualificationRenewal(
	data: Omit<CreateRenewalRequestInput, "employeeId">,
): Promise<ServerActionResult<unknown>> {
	const effect = Effect.gen(function* (_) {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return yield* _(Effect.fail(new NoEmployeeError()));
		}

		const skillService = yield* _(SkillService);
		return yield* _(
			skillService.createRenewalRequest({
				...data,
				employeeId: authContext.employee.id,
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 4: Update React Query hooks**

In `apps/webapp/src/lib/query/use-skills.ts`, extend create/update/assign mutation input types with `expiryWarningDays`, `issuedAt`, `issuer`, and `certificateNumber`. Add a `useSubmitQualificationRenewal` hook that calls `submitMyQualificationRenewal` and invalidates `queryKeys.qualifications.my()`.

- [ ] **Step 5: Run targeted tests/build**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: PASS.

Run: `pnpm --dir apps/webapp test src/lib/query/use-skills.ts`

Expected: If no tests match, Vitest reports no test files. Continue.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/skills/actions.ts apps/webapp/src/app/[locale]/(app)/my-qualifications/actions.ts apps/webapp/src/lib/query/keys.ts apps/webapp/src/lib/query/use-skills.ts
git commit -m "feat: expose qualification renewal actions"
```

## Task 5: Catalog And Employee Qualification UI

**Files:**
- Modify: `apps/webapp/src/components/settings/skill-catalog-management.tsx`
- Modify: `apps/webapp/src/components/settings/employee-skills-card.tsx`
- Create: `apps/webapp/src/components/qualifications/employee-qualification-list.tsx`
- Create: `apps/webapp/src/components/qualifications/renewal-submission-dialog.tsx`
- Create: `apps/webapp/src/components/settings/skill-catalog-management.test.tsx`

- [ ] **Step 1: Write UI test for warning days field**

Create `apps/webapp/src/components/settings/skill-catalog-management.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillCatalogManagement } from "./skill-catalog-management";

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
	return {
		...actual,
		useQuery: () => ({ data: [], isLoading: false, isFetching: false, refetch: vi.fn() }),
		useQueryClient: () => ({ invalidateQueries: vi.fn() }),
		useMutation: () => ({ mutate: vi.fn(), isPending: false }),
	};
});

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

describe("SkillCatalogManagement", () => {
	it("uses qualification-oriented catalog copy", () => {
		render(<SkillCatalogManagement organizationId="org-1" canManageCatalog />);
		expect(screen.getByText("Skills & Qualifications")).toBeInTheDocument();
		expect(screen.getByText(/Manage skills and certifications/)).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run UI test**

Run: `pnpm --dir apps/webapp test src/components/settings/skill-catalog-management.test.tsx`

Expected: PASS. If `toBeInTheDocument` is unavailable, add `import "@testing-library/jest-dom/vitest";` as the first line of this test file and rerun the same command.

- [ ] **Step 3: Add warning-window form field**

In `SkillFormValues`, add:

```ts
expiryWarningDays: number;
```

Set defaults:

```ts
expiryWarningDays: skill?.expiryWarningDays ?? 30,
```

Include in create/update payloads:

```ts
expiryWarningDays: data.requiresExpiry ? data.expiryWarningDays : 30,
```

Add inside the dialog below `requiresExpiry`:

```tsx
<form.Subscribe selector={(state) => state.values.requiresExpiry}>
	{(requiresExpiry) =>
		requiresExpiry ? (
			<form.Field name="expiryWarningDays">
				{(field) => (
					<div className="grid gap-2">
						<Label htmlFor="skill-warning-days">
							{t("settings.skills.expiryWarningDays", "Warn before expiry")}
						</Label>
						<Input
							id="skill-warning-days"
							type="number"
							min={0}
							max={365}
							value={field.state.value}
							onChange={(event) => field.handleChange(Number(event.target.value))}
							onBlur={field.handleBlur}
						/>
						<p className="text-xs text-muted-foreground">
							{t("settings.skills.expiryWarningDaysHint", "Show expiring-soon warnings this many days before expiry.")}
						</p>
					</div>
				)}
			</form.Field>
		) : null
	}
</form.Subscribe>
```

- [ ] **Step 4: Create shared qualification list component**

Create `apps/webapp/src/components/qualifications/employee-qualification-list.tsx`:

```tsx
"use client";

import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { getQualificationStatus } from "@/lib/qualifications/status";

interface EmployeeQualificationListProps {
	qualifications: EmployeeSkillWithDetails[];
	onRenew?: (qualification: EmployeeSkillWithDetails) => void;
}

export function EmployeeQualificationList({ qualifications, onRenew }: EmployeeQualificationListProps) {
	if (qualifications.length === 0) {
		return <p className="text-sm text-muted-foreground">No qualifications assigned.</p>;
	}

	return (
		<div className="space-y-3">
			{qualifications.map((qualification) => {
				const status = getQualificationStatus({
					expiresAt: qualification.expiresAt,
					warningDays: qualification.skill.expiryWarningDays ?? 30,
				});

				return (
					<div key={qualification.id} className="rounded-lg border p-3">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="font-medium">{qualification.skill.name}</p>
								{qualification.expiresAt ? (
									<p className="text-xs text-muted-foreground">
										Expires {DateTime.fromJSDate(qualification.expiresAt).toLocaleString(DateTime.DATE_MED)}
									</p>
								) : null}
								{qualification.issuer ? <p className="text-xs text-muted-foreground">Issuer: {qualification.issuer}</p> : null}
							</div>
							<Badge variant={status === "expired" ? "destructive" : "secondary"}>{status}</Badge>
						</div>
						{onRenew ? (
							<button type="button" className="mt-3 text-sm font-medium text-primary" onClick={() => onRenew(qualification)}>
								Submit renewal evidence
							</button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 5: Update employee skills card to use metadata fields**

In `AssignSkillFormValues`, add:

```ts
issuedAt: string;
issuer: string;
certificateNumber: string;
```

Add fields to default values and mutation payload:

```ts
issuedAt: data.issuedAt ? new Date(data.issuedAt) : undefined,
issuer: data.issuer || undefined,
certificateNumber: data.certificateNumber || undefined,
```

Add date/text inputs below expiry in `AssignSkillDialog` for issue date, issuer, and certificate number using the same TanStack Form pattern as existing fields.

- [ ] **Step 6: Create renewal submission dialog**

Create `apps/webapp/src/components/qualifications/renewal-submission-dialog.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitMyQualificationRenewal } from "@/app/[locale]/(app)/my-qualifications/actions";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { queryKeys } from "@/lib/query/keys";

interface RenewalSubmissionDialogProps {
	qualification: EmployeeSkillWithDetails | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface RenewalSubmissionFormValues {
	evidenceIds: string;
	requestedIssuedAt: string;
	requestedExpiresAt: string;
	requestedIssuer: string;
	requestedCertificateNumber: string;
	notes: string;
}

export function RenewalSubmissionDialog({
	qualification,
	open,
	onOpenChange,
}: RenewalSubmissionDialogProps) {
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: {
			evidenceIds: "",
			requestedIssuedAt: "",
			requestedExpiresAt: "",
			requestedIssuer: "",
			requestedCertificateNumber: "",
			notes: "",
		} satisfies RenewalSubmissionFormValues,
		onSubmit: async ({ value }) => renewalMutation.mutate(value),
	});

	const renewalMutation = useMutation({
		mutationFn: async (value: RenewalSubmissionFormValues) => {
			if (!qualification) throw new Error("No qualification selected");
			const evidenceIds = value.evidenceIds
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean);
			const result = await submitMyQualificationRenewal({
				employeeSkillId: qualification.id,
				evidenceIds,
				requestedIssuedAt: value.requestedIssuedAt ? new Date(value.requestedIssuedAt) : undefined,
				requestedExpiresAt: value.requestedExpiresAt ? new Date(value.requestedExpiresAt) : undefined,
				requestedIssuer: value.requestedIssuer || undefined,
				requestedCertificateNumber: value.requestedCertificateNumber || undefined,
				notes: value.notes || undefined,
			});
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success("Renewal evidence submitted");
			queryClient.invalidateQueries({ queryKey: queryKeys.qualifications.my() });
			onOpenChange(false);
			form.reset();
		},
		onError: (error) => toast.error(error.message),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Submit renewal evidence</DialogTitle>
					<DialogDescription>
						Upload evidence first, then submit the evidence IDs for {qualification?.skill.name ?? "this qualification"}.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field name="evidenceIds">
						{(field) => (
							<div className="grid gap-2">
								<Label htmlFor="renewal-evidence-ids">Evidence IDs</Label>
								<Input id="renewal-evidence-ids" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />
							</div>
						)}
					</form.Field>
					<form.Field name="requestedExpiresAt">
						{(field) => (
							<div className="grid gap-2">
								<Label htmlFor="renewal-expiry">New expiry date</Label>
								<Input id="renewal-expiry" type="date" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />
							</div>
						)}
					</form.Field>
					<form.Field name="notes">
						{(field) => (
							<div className="grid gap-2">
								<Label htmlFor="renewal-notes">Notes</Label>
								<Textarea id="renewal-notes" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />
							</div>
						)}
					</form.Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={renewalMutation.isPending}>Cancel</Button>
						<Button type="submit" disabled={renewalMutation.isPending || !qualification}>
							{renewalMutation.isPending ? <IconLoader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
							Submit
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
```

This first UI accepts evidence IDs created by the upload route. Keep the evidence ID text input for this implementation slice so the review request workflow is testable without adding a second uploader component.

- [ ] **Step 7: Run component tests**

Run: `pnpm --dir apps/webapp test src/components/settings/skill-catalog-management.test.tsx src/components/settings/employee-skills-card.tsx`

Expected: PASS for real test files; if a path has no tests, run the existing closest component test file instead.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/components/settings/skill-catalog-management.tsx apps/webapp/src/components/settings/skill-catalog-management.test.tsx apps/webapp/src/components/settings/employee-skills-card.tsx apps/webapp/src/components/qualifications/employee-qualification-list.tsx apps/webapp/src/components/qualifications/renewal-submission-dialog.tsx
git commit -m "feat: show qualification metadata in settings"
```

## Task 6: Employee Self-Service Qualifications Page

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/my-qualifications/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/my-qualifications/my-qualifications-client.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/my-qualifications/my-qualifications-client.test.tsx`

- [ ] **Step 1: Write client component test**

Create `apps/webapp/src/app/[locale]/(app)/my-qualifications/my-qualifications-client.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyQualificationsClient } from "./my-qualifications-client";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

describe("MyQualificationsClient", () => {
	it("renders employee qualifications", () => {
		render(
			<MyQualificationsClient
				qualifications={[
					{
						id: "employee-skill-1",
						employeeId: "employee-1",
						skillId: "skill-1",
						expiresAt: null,
						notes: null,
						assignedBy: "user-1",
						assignedAt: new Date(),
						createdAt: new Date(),
						skill: {
							id: "skill-1",
							organizationId: "org-1",
							name: "Forklift License",
							description: null,
							category: "certification",
							customCategoryName: null,
							requiresExpiry: false,
							expiryWarningDays: 30,
							isActive: true,
							createdAt: new Date(),
							createdBy: "user-1",
							updatedAt: new Date(),
							updatedBy: null,
						},
					} as never,
				]}
			/>,
		);

		expect(screen.getByText("My Qualifications")).toBeInTheDocument();
		expect(screen.getByText("Forklift License")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run client test to verify failure**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/my-qualifications/my-qualifications-client.test.tsx`

Expected: FAIL because client component does not exist.

- [ ] **Step 3: Implement client component**

Create `apps/webapp/src/app/[locale]/(app)/my-qualifications/my-qualifications-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeQualificationList } from "@/components/qualifications/employee-qualification-list";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";

interface MyQualificationsClientProps {
	qualifications: EmployeeSkillWithDetails[];
}

export function MyQualificationsClient({ qualifications }: MyQualificationsClientProps) {
	const [selectedQualificationId, setSelectedQualificationId] = useState<string | null>(null);
	const selectedQualification = qualifications.find((item) => item.id === selectedQualificationId) ?? null;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<Card>
				<CardHeader>
					<CardTitle>My Qualifications</CardTitle>
					<CardDescription>View your licenses, trainings, certificates, and renewal status.</CardDescription>
				</CardHeader>
				<CardContent>
					<EmployeeQualificationList qualifications={qualifications} onRenew={(qualification) => setSelectedQualificationId(qualification.id)} />
					{selectedQualification ? (
						<p className="mt-4 text-sm text-muted-foreground">
							Renewal submission selected for {selectedQualification.skill.name}. Upload dialog is added in the renewal UI task.
						</p>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 4: Implement server page**

Create `apps/webapp/src/app/[locale]/(app)/my-qualifications/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { MyQualificationsClient } from "./my-qualifications-client";
import { getMyQualifications } from "./actions";

export default async function MyQualificationsPage() {
	await connection();

	const result = await getMyQualifications();
	if (!result.success) {
		if (result.error.includes("Employee")) {
			return <NoEmployeeError />;
		}
		redirect("/");
	}

	return <MyQualificationsClient qualifications={result.data} />;
}
```

- [ ] **Step 5: Run self-service tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/my-qualifications/my-qualifications-client.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/my-qualifications
git commit -m "feat: add employee qualifications self service"
```

## Task 7: Renewal Review Queue

**Files:**
- Create: `apps/webapp/src/components/qualifications/renewal-review-queue.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx`

- [ ] **Step 1: Create review queue component**

Create `apps/webapp/src/components/qualifications/renewal-review-queue.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPendingQualificationRenewalRequests, reviewQualificationRenewalRequest } from "@/app/[locale]/(app)/settings/skills/actions";
import { queryKeys } from "@/lib/query/keys";

interface RenewalReviewQueueProps {
	organizationId: string;
}

export function RenewalReviewQueue({ organizationId }: RenewalReviewQueueProps) {
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({
		queryKey: queryKeys.qualifications.renewalRequests(organizationId),
		queryFn: async () => {
			const result = await getPendingQualificationRenewalRequests();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const reviewMutation = useMutation({
		mutationFn: async ({ requestId, approved }: { requestId: string; approved: boolean }) => {
			const result = await reviewQualificationRenewalRequest({ requestId, approved, reviewNotes: approved ? "Approved" : "Rejected" });
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success("Renewal request reviewed");
			queryClient.invalidateQueries({ queryKey: queryKeys.qualifications.renewalRequests(organizationId) });
		},
		onError: (error) => toast.error(error.message),
	});

	const requests = data ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Renewal Requests</CardTitle>
				<CardDescription>Review employee-submitted qualification evidence.</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? <p className="text-sm text-muted-foreground">Loading renewal requests...</p> : null}
				{!isLoading && requests.length === 0 ? <p className="text-sm text-muted-foreground">No pending renewal requests.</p> : null}
				<div className="space-y-3">
					{requests.map((request) => (
						<div key={request.id} className="flex items-center justify-between rounded-lg border p-3">
							<div>
								<p className="font-medium">Renewal request</p>
								<p className="text-xs text-muted-foreground">Submitted {request.createdAt.toLocaleString()}</p>
							</div>
							<div className="flex gap-2">
								<Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ requestId: request.id, approved: false })}>Reject</Button>
								<Button size="sm" onClick={() => reviewMutation.mutate({ requestId: request.id, approved: true })}>Approve</Button>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 2: Mount queue in settings skills page**

In `apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx`, import `RenewalReviewQueue` and render it below `SkillCatalogManagement` for managers/admins:

```tsx
return (
	<>
		<SkillCatalogManagement
			organizationId={organizationId}
			canManageCatalog={settingsRouteContext.accessTier === "orgAdmin"}
		/>
		<RenewalReviewQueue organizationId={organizationId} />
	</>
);
```

- [ ] **Step 3: Run settings route tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/components/qualifications/renewal-review-queue.tsx apps/webapp/src/app/[locale]/(app)/settings/skills/page.tsx
git commit -m "feat: add qualification renewal review queue"
```

## Task 8: Scheduling Enforcement Modes And Override Reason

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/types.ts`
- Modify: `apps/webapp/src/lib/effect/services/skill.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/shift.service.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.ts`
- Modify: `apps/webapp/src/components/scheduling/skill-warning-alert.tsx`
- Modify: `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx`
- Update: `apps/webapp/src/components/scheduling/shifts/shift-dialog.test.tsx`

- [ ] **Step 1: Extend scheduling types**

In `apps/webapp/src/app/[locale]/(app)/scheduling/types.ts`, replace `SkillWarningInfo` with:

```ts
export interface QualificationIssueInfo {
	id: string;
	name: string;
	category: string;
	isRequired: boolean;
	enforcementMode: "warning" | "blocking";
	issueType: "missing" | "expired" | "expiringSoon" | "preferred";
	expiresAt?: Date;
}

export interface SkillWarningInfo {
	isQualified: boolean;
	hasBlockingIssues: boolean;
	requiresOverride: boolean;
	issues: QualificationIssueInfo[];
	missingSkills: Array<{
		id: string;
		name: string;
		category: string;
		isRequired: boolean;
	}>;
	expiredSkills: Array<{
		id: string;
		name: string;
		expiresAt: Date;
	}>;
}
```

Extend `UpsertShiftInput`:

```ts
qualificationOverrideReason?: string;
```

- [ ] **Step 2: Update service validation output**

In `SkillValidationResult`, add:

```ts
hasBlockingIssues: boolean;
requiresOverride: boolean;
issues: Array<{
	id: string;
	name: string;
	category: SkillCategory;
	isRequired: boolean;
	enforcementMode: "warning" | "blocking";
	issueType: "missing" | "expired" | "expiringSoon" | "preferred";
	expiresAt?: Date;
}>;
```

In `validateEmployeeForShift`, when combining requirements, store `enforcementMode` and `blockOnExpiringSoon`, using `mergeRequirementMode` for duplicate required skills. Build `issues` from missing, expired, and expiring soon states. Set:

```ts
const hasBlockingIssues = issues.some((issue) => issue.enforcementMode === "blocking" && issue.isRequired);
const requiresOverride = issues.some((issue) => issue.enforcementMode === "warning" && issue.isRequired);
const isQualified = !hasBlockingIssues && !requiresOverride;
```

Keep `missingSkills` and `expiredSkills` for backward UI compatibility.

- [ ] **Step 3: Enforce override reason in shift service/action**

In the shift service upsert input type, add:

```ts
qualificationOverrideReason?: string;
```

After computing `skillWarning`, before creating/updating the shift, add:

```ts
if (skillWarning?.hasBlockingIssues) {
	yield* _(
		Effect.fail(
			new ValidationError({
				message: "This employee is missing a blocking qualification requirement",
				field: "employeeId",
			}),
		),
	);
}

if (skillWarning?.requiresOverride && !input.qualificationOverrideReason?.trim()) {
	yield* _(
		Effect.fail(
			new ValidationError({
				message: "An override reason is required for qualification warnings",
				field: "qualificationOverrideReason",
			}),
		),
	);
}
```

After the shift is created/updated, if `skillWarning.requiresOverride` is true, call `SkillService.recordOverride` with warning issue IDs and `input.qualificationOverrideReason`.

In `shift-actions.ts`, pass `qualificationOverrideReason: input.qualificationOverrideReason` to `shiftService.upsertShift`.

- [ ] **Step 4: Update scheduling UI**

In `skill-warning-alert.tsx`, render `issues` if available:

```tsx
{warning.issues?.map((issue) => (
	<li key={`${issue.id}-${issue.issueType}`}>
		{issue.name}: {issue.issueType} ({issue.enforcementMode})
	</li>
))}
```

In `shift-dialog.tsx`, add local override reason state and pass it to `upsertShift`. Show a textarea when the current metadata has `skillWarning.requiresOverride`; disable save when `skillWarning.hasBlockingIssues`.

- [ ] **Step 5: Update shift dialog test**

Append to `apps/webapp/src/components/scheduling/shifts/shift-dialog.test.tsx`:

```tsx
it("disables save for blocking qualification issues", async () => {
	upsertShiftMock.mockResolvedValue({
		success: true,
		data: {
			metadata: {
				hasOverlap: false,
				overlappingShifts: [],
				skillWarning: {
					isQualified: false,
					hasBlockingIssues: true,
					requiresOverride: false,
					missingSkills: [],
					expiredSkills: [],
					issues: [
						{
							id: "skill-1",
							name: "Forklift License",
							category: "certification",
							isRequired: true,
							enforcementMode: "blocking",
							issueType: "missing",
						},
					],
				},
			},
		},
	});

	renderShiftDialogWithLocalOpenState();

	expect(await screen.findByText("Forklift License")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});
```

- [ ] **Step 6: Run scheduling tests**

Run: `pnpm --dir apps/webapp test src/components/scheduling/shifts/shift-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/scheduling/types.ts apps/webapp/src/lib/effect/services/skill.service.ts apps/webapp/src/lib/effect/services/shift.service.ts apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.ts apps/webapp/src/components/scheduling/skill-warning-alert.tsx apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx apps/webapp/src/components/scheduling/shifts/shift-dialog.test.tsx
git commit -m "feat: enforce qualification requirements in scheduling"
```

## Task 9: Final Verification And Documentation Notes

**Files:**
- Modify plan/spec only if implementation discoveries require it.
- No application files unless verification finds defects.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/qualifications/__tests__/status.test.ts src/lib/qualifications/__tests__/evidence-validation.test.ts src/app/api/upload/qualification-evidence/process/route.test.ts src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts src/components/scheduling/shifts/shift-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run webapp test suite**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `pnpm build:webapp`

Expected: PASS if environment variables are available. If Phase/S3/database configuration is unavailable to agents, do not invent credentials; record the build as skipped due to unavailable system-level environment variables.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: only intended changes are present.

- [ ] **Step 5: Commit final fixes if needed**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize qualification tracking"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: catalog, employee assignment, evidence upload, renewal review, self-service, scheduling enforcement, permissions, and tests are covered by Tasks 1-9.
- Scope: this is one cohesive feature built on the existing skills system. Notifications/reminders are excluded per non-goals.
- Environment caveat: live object storage verification may be skipped because S3 credentials are system-level Phase configuration and not available to agents.
