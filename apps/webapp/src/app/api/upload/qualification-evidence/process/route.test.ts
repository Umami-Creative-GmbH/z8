import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const findEmployeeSkillMock = vi.fn();
const insertValuesMock = vi.fn();
const employeeSkillId = "11111111-1111-4111-8111-111111111111";

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(async () => ({
		employee: { id: "employee-1", organizationId: "org-1" },
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
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
		findEmployeeSkillMock.mockResolvedValue({ id: employeeSkillId, employeeId: "employee-1" });
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
					fileKey: `qualification-evidence/org-1/${employeeSkillId}/Forklift.pdf`,
				},
			],
		});
	});

	it("creates qualification evidence metadata for an employee-owned qualification", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			request({
				tusFileKey: "tmp-upload-key",
				employeeSkillId,
				fileName: "Forklift.pdf",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			success: true,
			evidence: { id: "evidence-1", fileName: "Forklift.pdf" },
		});
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeSkillId,
				uploadedBy: "user-1",
			}),
		);
		expect(sendMock.mock.calls[1]?.[0].input.Metadata).toMatchObject({
			"uploaded-by": "user-1",
		});
	});

	it("rejects invalid employee skill IDs before querying", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			request({
				tusFileKey: "tmp-upload-key",
				employeeSkillId: "not-a-uuid",
				fileName: "Forklift.pdf",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid employeeSkillId" });
		expect(findEmployeeSkillMock).not.toHaveBeenCalled();
	});
});
