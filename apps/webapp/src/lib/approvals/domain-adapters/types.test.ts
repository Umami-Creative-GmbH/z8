import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as adapterTypes from "./types";

const source = readFileSync(
	fileURLToPath(new URL("./types.ts", import.meta.url)),
	"utf8",
);

describe("approval domain adapter boundary", () => {
	it("keeps post-commit handling outside the engine-visible adapter", () => {
		const adapterStart = source.indexOf(
			"export interface ApprovalDomainAdapter<",
		);
		const handlerStart = source.indexOf(
			"export interface ApprovalPostCommitHandler",
		);
		expect(adapterStart).toBeGreaterThan(-1);
		expect(handlerStart).toBeGreaterThan(adapterStart);

		const adapterContract = source.slice(adapterStart, handlerStart);
		expect(adapterContract).not.toContain("describePostCommitEvents");
		expect(adapterContract).not.toContain("handlePostCommitEvent");
	});

	it("exposes exactly one terminal source mutation method", () => {
		const adapterStart = source.indexOf(
			"export interface ApprovalDomainAdapter<",
		);
		const handlerStart = source.indexOf(
			"export interface ApprovalPostCommitHandler",
		);
		const adapterContract = source.slice(adapterStart, handlerStart);
		expect(adapterContract.match(/finalizeTerminal\s*\(/g)).toHaveLength(1);
		expect(adapterContract).not.toContain("cancelApproved");
	});

	it("does not expose direct adapter capability minting", () => {
		expect(adapterTypes).not.toHaveProperty(
			"validateApprovedCancellationAuthorization",
		);
	});
});
