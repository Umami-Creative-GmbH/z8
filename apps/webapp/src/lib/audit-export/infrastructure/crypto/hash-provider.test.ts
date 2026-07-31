import { afterEach, describe, expect, it, vi } from "vitest";
import { SHA256HashProvider } from "./hash-provider";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SHA256HashProvider Merkle proofs", () => {
	const provider = new SHA256HashProvider();

	it.each([2, 3, 6])("verifies every proof for %i leaves", (leafCount) => {
		const leaves = Array.from({ length: leafCount }, (_, index) =>
			provider.hashString(`leaf-${index}`),
		);
		const { proofs, root } = provider.buildMerkleTreeWithProofs(leaves);

		for (const [index, leaf] of leaves.entries()) {
			const proof = proofs.get(index);
			expect(proof).toBeDefined();
			if (!proof) {
				throw new Error(`Missing proof for test leaf ${index}`);
			}
			expect(provider.verifyMerkleProof(leaf, proof, root)).toBe(true);
		}
	});

	it("throws an explicit invariant error if an initialized proof is absent", () => {
		const originalGet = Map.prototype.get;
		vi.spyOn(Map.prototype, "get").mockImplementation(function (key) {
			if (key === 0) {
				return undefined;
			}
			return originalGet.call(this, key);
		});

		expect(() =>
			provider.buildMerkleTreeWithProofs([
				provider.hashString("left"),
				provider.hashString("right"),
			]),
		).toThrow("Missing Merkle proof for leaf 0");
	});
});
