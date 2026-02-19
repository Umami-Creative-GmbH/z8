import { describe, expect, it, vi } from "vitest";
import {
	AuditPackOrchestrator,
	type AuditPackOrchestratorDependencies,
	type AuditPackRepository,
} from "../audit-pack-orchestrator";

function createRepositoryMocks() {
	const setStatus: AuditPackRepository["setStatus"] = vi.fn().mockResolvedValue(undefined);
	const failRequest: AuditPackRepository["failRequest"] = vi.fn().mockResolvedValue(undefined);
	const storeArtifact: AuditPackRepository["storeArtifact"] = vi.fn().mockResolvedValue(undefined);

	const repository: AuditPackRepository = {
		setStatus,
		failRequest,
		storeArtifact,
	};

	return {
		repository,
		setStatus,
		failRequest,
		storeArtifact,
	};
}

function createDependencyMocks() {
	const collect: AuditPackOrchestratorDependencies["collect"] = vi.fn().mockResolvedValue({
		baseEntries: ["e-1"],
	});
	const expandLineage: AuditPackOrchestratorDependencies["expandLineage"] = vi.fn().mockResolvedValue({
		lineageEntries: ["e-1", "e-2"],
	});
	const assemble: AuditPackOrchestratorDependencies["assemble"] = vi.fn().mockResolvedValue({
		zipBuffer: Buffer.from("zip"),
		counts: {
			entryCount: 2,
			correctionNodeCount: 1,
			approvalEventCount: 1,
			timelineEventCount: 3,
			expandedNodeCount: 1,
		},
	});
	const harden: AuditPackOrchestratorDependencies["harden"] = vi.fn().mockResolvedValue({
		auditPackageId: "pkg-1",
		s3Key: "org-1/pkg-1.zip",
	});

	return {
		dependencies: {
			collect,
			expandLineage,
			assemble,
			harden,
		},
		collect,
		expandLineage,
		assemble,
		harden,
	};
}

describe("AuditPackOrchestrator", () => {
	it("updates request status through all stages before completion", async () => {
		const repoMocks = createRepositoryMocks();
		const depMocks = createDependencyMocks();
		const orchestrator = new AuditPackOrchestrator(repoMocks.repository, depMocks.dependencies);

		await orchestrator.generate({ requestId: "req-1", organizationId: "org-1" });

		expect(repoMocks.setStatus).toHaveBeenNthCalledWith(1, {
			requestId: "req-1",
			organizationId: "org-1",
			status: "collecting",
		});
		expect(repoMocks.setStatus).toHaveBeenNthCalledWith(2, {
			requestId: "req-1",
			organizationId: "org-1",
			status: "lineage_expanding",
		});
		expect(repoMocks.setStatus).toHaveBeenNthCalledWith(3, {
			requestId: "req-1",
			organizationId: "org-1",
			status: "assembling",
		});
		expect(repoMocks.setStatus).toHaveBeenNthCalledWith(4, {
			requestId: "req-1",
			organizationId: "org-1",
			status: "hardening",
		});
		expect(repoMocks.setStatus).toHaveBeenNthCalledWith(5, {
			requestId: "req-1",
			organizationId: "org-1",
			status: "completed",
		});
		expect(repoMocks.failRequest).not.toHaveBeenCalled();
		expect(repoMocks.storeArtifact).toHaveBeenCalledWith({
			requestId: "req-1",
			organizationId: "org-1",
			auditExportPackageId: "pkg-1",
			s3Key: "org-1/pkg-1.zip",
			entryCount: 2,
			correctionNodeCount: 1,
			approvalEventCount: 1,
			timelineEventCount: 3,
			expandedNodeCount: 1,
		});
	});

	it("marks failed and rethrows when a stage errors", async () => {
		const repoMocks = createRepositoryMocks();
		const depMocks = createDependencyMocks();
		const dependencies: AuditPackOrchestratorDependencies = {
			...depMocks.dependencies,
			harden: async () => {
				throw new Error("hardening blew up");
			},
		};

		const orchestrator = new AuditPackOrchestrator(repoMocks.repository, dependencies);

		await expect(
			orchestrator.generate({ requestId: "req-2", organizationId: "org-1" }),
		).rejects.toThrow("hardening blew up");

		expect(repoMocks.setStatus).toHaveBeenCalledWith({
			requestId: "req-2",
			organizationId: "org-1",
			status: "hardening",
		});
		expect(repoMocks.failRequest).toHaveBeenCalledWith({
			requestId: "req-2",
			organizationId: "org-1",
			status: "failed",
			errorCode: "audit_pack_generation_failed",
			errorMessage: "hardening blew up",
		});
		expect(repoMocks.storeArtifact).not.toHaveBeenCalled();
		expect(repoMocks.setStatus).not.toHaveBeenCalledWith({
			requestId: "req-2",
			organizationId: "org-1",
			status: "completed",
		});
	});
});
