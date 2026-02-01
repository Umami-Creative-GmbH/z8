/**
 * SHA-256 Hash Provider with Merkle Tree Support
 * Infrastructure layer implementation
 */
import crypto from "node:crypto";
import { SHA256Hash } from "../../domain/models";

// ============================================
// INTERFACE
// ============================================

export interface IHashProvider {
	/**
	 * Calculate SHA-256 hash of a buffer
	 */
	hashBuffer(data: Buffer): SHA256Hash;

	/**
	 * Calculate SHA-256 hash of a string
	 */
	hashString(data: string): SHA256Hash;

	/**
	 * Build Merkle tree root from array of hashes
	 * Uses a binary tree structure where each non-leaf node is
	 * the hash of concatenated child hashes
	 */
	buildMerkleRoot(hashes: SHA256Hash[]): SHA256Hash;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class SHA256HashProvider implements IHashProvider {
	/**
	 * Calculate SHA-256 hash of a buffer
	 */
	hashBuffer(data: Buffer): SHA256Hash {
		const hash = crypto.createHash("sha256").update(data).digest("hex");
		return new SHA256Hash(hash);
	}

	/**
	 * Calculate SHA-256 hash of a string (UTF-8 encoding)
	 */
	hashString(data: string): SHA256Hash {
		return this.hashBuffer(Buffer.from(data, "utf-8"));
	}

	/**
	 * Build Merkle tree root from array of hashes
	 *
	 * Algorithm:
	 * 1. Start with leaf hashes
	 * 2. Pair adjacent hashes and hash them together
	 * 3. If odd number, duplicate the last hash
	 * 4. Repeat until single root hash remains
	 *
	 * Example with 4 files (A, B, C, D):
	 *       Root
	 *      /    \
	 *   H(AB)  H(CD)
	 *   /  \   /  \
	 *  A    B C    D
	 */
	buildMerkleRoot(hashes: SHA256Hash[]): SHA256Hash {
		if (hashes.length === 0) {
			throw new Error("Cannot build Merkle root from empty array");
		}

		if (hashes.length === 1) {
			return hashes[0];
		}

		// Convert to string array for processing
		let currentLevel = hashes.map((h) => h.toString());

		while (currentLevel.length > 1) {
			const nextLevel: string[] = [];

			for (let i = 0; i < currentLevel.length; i += 2) {
				const left = currentLevel[i];
				// If odd number, duplicate the last hash
				const right = currentLevel[i + 1] ?? left;

				// Concatenate raw bytes (not hex strings) to prevent collision attacks
				// This is critical for Merkle tree security
				const combined = crypto
					.createHash("sha256")
					.update(Buffer.from(left, "hex"))
					.update(Buffer.from(right, "hex"))
					.digest("hex");

				nextLevel.push(combined);
			}

			currentLevel = nextLevel;
		}

		return new SHA256Hash(currentLevel[0]);
	}

	/**
	 * Build Merkle tree with proof paths for verification
	 * Returns the root and proof paths for each leaf
	 */
	buildMerkleTreeWithProofs(hashes: SHA256Hash[]): {
		root: SHA256Hash;
		proofs: Map<number, MerkleProof>;
	} {
		if (hashes.length === 0) {
			throw new Error("Cannot build Merkle tree from empty array");
		}

		if (hashes.length === 1) {
			return {
				root: hashes[0],
				proofs: new Map([[0, { path: [], indices: [] }]]),
			};
		}

		// Build tree levels bottom-up, tracking proofs
		const proofs = new Map<number, MerkleProof>();
		const leafCount = hashes.length;

		// Initialize proofs for each leaf
		for (let i = 0; i < leafCount; i++) {
			proofs.set(i, { path: [], indices: [] });
		}

		let currentLevel = hashes.map((h) => h.toString());
		let levelSize = currentLevel.length;
		let leafIndices = Array.from({ length: leafCount }, (_, i) => i);

		while (currentLevel.length > 1) {
			const nextLevel: string[] = [];
			const nextLeafIndices: number[] = [];

			for (let i = 0; i < currentLevel.length; i += 2) {
				const left = currentLevel[i];
				const right = currentLevel[i + 1] ?? left;
				// Concatenate raw bytes (not hex strings) to prevent collision attacks
				const combined = crypto
					.createHash("sha256")
					.update(Buffer.from(left, "hex"))
					.update(Buffer.from(right, "hex"))
					.digest("hex");
				nextLevel.push(combined);

				// Update proofs for leaves in this pair
				for (let leafIdx = 0; leafIdx < leafCount; leafIdx++) {
					const currentIdx = leafIndices[leafIdx];
					if (currentIdx === i) {
						// This leaf is on the left, add right sibling to proof
						proofs.get(leafIdx)!.path.push(new SHA256Hash(right));
						proofs.get(leafIdx)!.indices.push("right");
						nextLeafIndices[leafIdx] = Math.floor(i / 2);
					} else if (currentIdx === i + 1) {
						// This leaf is on the right, add left sibling to proof
						proofs.get(leafIdx)!.path.push(new SHA256Hash(left));
						proofs.get(leafIdx)!.indices.push("left");
						nextLeafIndices[leafIdx] = Math.floor(i / 2);
					} else if (nextLeafIndices[leafIdx] === undefined) {
						nextLeafIndices[leafIdx] = Math.floor(currentIdx / 2);
					}
				}
			}

			currentLevel = nextLevel;
			leafIndices = nextLeafIndices;
			levelSize = currentLevel.length;
		}

		return {
			root: new SHA256Hash(currentLevel[0]),
			proofs,
		};
	}

	/**
	 * Verify a Merkle proof for a specific leaf
	 */
	verifyMerkleProof(
		leafHash: SHA256Hash,
		proof: MerkleProof,
		expectedRoot: SHA256Hash,
	): boolean {
		let currentHash = leafHash.toString();

		for (let i = 0; i < proof.path.length; i++) {
			const siblingHash = proof.path[i].toString();
			const position = proof.indices[i];

			if (position === "left") {
				// Sibling is on the left - concatenate raw bytes
				currentHash = crypto
					.createHash("sha256")
					.update(Buffer.from(siblingHash, "hex"))
					.update(Buffer.from(currentHash, "hex"))
					.digest("hex");
			} else {
				// Sibling is on the right - concatenate raw bytes
				currentHash = crypto
					.createHash("sha256")
					.update(Buffer.from(currentHash, "hex"))
					.update(Buffer.from(siblingHash, "hex"))
					.digest("hex");
			}
		}

		return currentHash === expectedRoot.toString();
	}
}

// ============================================
// TYPES
// ============================================

export interface MerkleProof {
	/** Sibling hashes along the path to root */
	path: SHA256Hash[];
	/** Position of sibling at each level ("left" or "right") */
	indices: ("left" | "right")[];
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const hashProvider = new SHA256HashProvider();
