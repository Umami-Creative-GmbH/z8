import { describe, expect, it } from "vitest";
import { auditPackArtifact, auditPackRequest } from "@/db/schema/audit-pack";

describe("audit-pack schema", () => {
	it("defines request and artifact tables", () => {
		expect(auditPackRequest).toBeDefined();
		expect(auditPackArtifact).toBeDefined();
	});
});
