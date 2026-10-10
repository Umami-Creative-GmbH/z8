import { describe, expect, it } from "vitest";
import { PERSONNEL_DOCUMENT_MAX_BYTES, personnelDocumentFileProblem } from "./document.types";

describe("personnelDocumentFileProblem", () => {
	it("accepts PDF, JPEG, PNG and WebP files up to 20 MB", () => {
		for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
			expect(personnelDocumentFileProblem({ type, name: "note", size: 1024 })).toBeNull();
		}
		expect(
			personnelDocumentFileProblem({
				type: "image/jpeg",
				name: "note.jpg",
				size: PERSONNEL_DOCUMENT_MAX_BYTES,
			}),
		).toBeNull();
	});

	it("refuses HEIC by type or name, other types and larger files", () => {
		expect(personnelDocumentFileProblem({ type: "image/heic", name: "a.heic", size: 1 })).toBe(
			"heic",
		);
		expect(personnelDocumentFileProblem({ type: "", name: "IMG_0001.HEIC", size: 1 })).toBe("heic");
		expect(personnelDocumentFileProblem({ type: "image/gif", name: "a.gif", size: 1 })).toBe(
			"unsupported_type",
		);
		expect(
			personnelDocumentFileProblem({
				type: "application/pdf",
				name: "a.pdf",
				size: PERSONNEL_DOCUMENT_MAX_BYTES + 1,
			}),
		).toBe("too_large");
	});
});
