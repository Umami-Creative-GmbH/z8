import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employeeSkill, qualificationEvidence } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	isAllowedQualificationEvidenceMime,
	isValidTusFileKey,
	MAX_QUALIFICATION_EVIDENCE_BYTES,
	sanitizeQualificationEvidenceFileName,
} from "@/lib/qualifications/evidence-validation";
import { S3_BUCKET, s3Client } from "@/lib/storage/s3-client";

interface ProcessQualificationEvidenceUploadRequest {
	tusFileKey: string;
	employeeSkillId: string;
	fileName?: string;
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
	await connection();

	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return NextResponse.json(
				{ error: "Not authenticated", code: "not_authenticated" },
				{ status: 401 },
			);
		}

		const body = (await request.json()) as ProcessQualificationEvidenceUploadRequest;
		const { tusFileKey, employeeSkillId, fileName } = body;

		if (!tusFileKey || !employeeSkillId) {
			return NextResponse.json(
				{
					error: "Missing tusFileKey or employeeSkillId",
					code: "missing_upload_parameters",
				},
				{ status: 400 },
			);
		}

		if (!isValidTusFileKey(tusFileKey)) {
			return NextResponse.json(
				{ error: "Invalid file key", code: "invalid_file_key" },
				{ status: 400 },
			);
		}

		if (!isUuid(employeeSkillId)) {
			return NextResponse.json(
				{ error: "Invalid employeeSkillId", code: "invalid_employee_skill_id" },
				{ status: 400 },
			);
		}

		const assignment = await db.query.employeeSkill.findFirst({
			where: and(
				eq(employeeSkill.id, employeeSkillId),
				eq(employeeSkill.employeeId, authContext.employee.id),
			),
			columns: { id: true, employeeId: true },
		});

		if (!assignment) {
			return NextResponse.json(
				{ error: "Qualification not found", code: "qualification_not_found" },
				{ status: 404 },
			);
		}

		const getResponse = await s3Client.send(
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: tusFileKey }),
		);

		if (getResponse.ContentLength && getResponse.ContentLength > MAX_QUALIFICATION_EVIDENCE_BYTES) {
			return NextResponse.json(
				{ error: "File too large. Maximum size is 10MB", code: "file_too_large" },
				{ status: 413 },
			);
		}

		const byteArray = await getResponse.Body?.transformToByteArray();
		if (!byteArray) {
			return NextResponse.json(
				{ error: "Failed to read uploaded file", code: "failed_to_read_file" },
				{ status: 500 },
			);
		}

		const buffer = Buffer.from(byteArray);
		if (buffer.length > MAX_QUALIFICATION_EVIDENCE_BYTES) {
			return NextResponse.json(
				{ error: "File too large. Maximum size is 10MB", code: "file_too_large" },
				{ status: 413 },
			);
		}

		const detectedType = await fileTypeFromBuffer(buffer);
		if (!detectedType || !isAllowedQualificationEvidenceMime(detectedType.mime)) {
			return NextResponse.json(
				{ error: "Unsupported file type", code: "unsupported_file_type" },
				{ status: 400 },
			);
		}

		const safeName = sanitizeQualificationEvidenceFileName(
			fileName?.trim() || `qualification-evidence.${detectedType.ext}`,
		);
		const finalName = safeName.includes(".") ? safeName : `${safeName}.${detectedType.ext}`;
		const finalStorageKey = `qualification-evidence/${authContext.employee.organizationId}/${employeeSkillId}/${Date.now()}-${finalName}`;

		await s3Client.send(
			new PutObjectCommand({
				Bucket: S3_BUCKET,
				Key: finalStorageKey,
				Body: buffer,
				ContentType: detectedType.mime,
				Metadata: {
					"uploaded-by": authContext.user.id,
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
				uploadedBy: authContext.user.id,
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
			});

		if (!createdEvidence) {
			return NextResponse.json(
				{ error: "Failed to create evidence record", code: "failed_to_create_evidence" },
				{ status: 500 },
			);
		}

		await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: tusFileKey }));

		return NextResponse.json({
			success: true,
			evidence: {
				id: createdEvidence.id,
				fileName: createdEvidence.fileName,
				mimeType: createdEvidence.mimeType,
				fileSize: createdEvidence.fileSize,
			},
		});
	} catch (error) {
		console.error("Qualification evidence upload processing failed", error);
		return NextResponse.json(
			{ error: "Processing failed", code: "processing_failed" },
			{ status: 500 },
		);
	}
}
