/**
 * Manifest Builder Domain Service
 * Constructs audit manifests with per-file hashes and Merkle tree
 */
import JSZip from "jszip";
import { createLogger } from "@/lib/logger";
import { AuditManifest, AuditFileEntry, SHA256Hash } from "./models";
import { hashProvider, type IHashProvider } from "../infrastructure/crypto/hash-provider";

const logger = createLogger("ManifestBuilder");

// ============================================
// INTERFACE
// ============================================

export interface IManifestBuilder {
	/**
	 * Build manifest from export ZIP buffer
	 */
	buildManifest(
		exportId: string,
		organizationId: string,
		exportType: "data" | "payroll",
		zipContent: Buffer,
	): Promise<{
		manifest: AuditManifest;
		manifestHash: SHA256Hash;
	}>;

	/**
	 * Verify manifest against ZIP content
	 */
	verifyManifest(manifest: AuditManifest, zipContent: Buffer): Promise<{
		isValid: boolean;
		invalidFiles: string[];
		merkleRootMatch: boolean;
	}>;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class ManifestBuilder implements IManifestBuilder {
	constructor(private readonly hash: IHashProvider = hashProvider) {}

	/**
	 * Build manifest from ZIP content
	 */
	async buildManifest(
		exportId: string,
		organizationId: string,
		exportType: "data" | "payroll",
		zipContent: Buffer,
	): Promise<{
		manifest: AuditManifest;
		manifestHash: SHA256Hash;
	}> {
		logger.info({ exportId, organizationId, exportType }, "Building audit manifest");

		// Load ZIP
		const zip = await JSZip.loadAsync(zipContent);

		// Extract and hash all files
		const fileEntries: AuditFileEntry[] = [];
		const fileHashes: SHA256Hash[] = [];

		// Get all file entries (excluding directories)
		const fileNames = Object.keys(zip.files)
			.filter((name) => !zip.files[name].dir)
			.sort(); // Sort for deterministic ordering

		let merkleIndex = 0;

		for (const fileName of fileNames) {
			const file = zip.files[fileName];
			const content = await file.async("nodebuffer");
			const hash = this.hash.hashBuffer(content);

			fileEntries.push(new AuditFileEntry(fileName, hash, content.length, merkleIndex));
			fileHashes.push(hash);
			merkleIndex++;
		}

		if (fileEntries.length === 0) {
			throw new Error("ZIP file contains no files");
		}

		// Build Merkle root
		const merkleRoot = this.hash.buildMerkleRoot(fileHashes);

		// Create manifest
		const manifest = new AuditManifest(
			exportId,
			organizationId,
			exportType,
			fileEntries,
			merkleRoot,
			new Date(),
		);

		// Calculate manifest hash (for signing)
		const manifestHash = this.hash.hashString(manifest.toCanonicalJSON());

		logger.info(
			{
				exportId,
				fileCount: fileEntries.length,
				merkleRoot: merkleRoot.toString().substring(0, 16),
				manifestHash: manifestHash.toString().substring(0, 16),
			},
			"Manifest built successfully",
		);

		return { manifest, manifestHash };
	}

	/**
	 * Verify manifest against ZIP content
	 */
	async verifyManifest(
		manifest: AuditManifest,
		zipContent: Buffer,
	): Promise<{
		isValid: boolean;
		invalidFiles: string[];
		merkleRootMatch: boolean;
	}> {
		logger.info({ exportId: manifest.exportId }, "Verifying manifest against ZIP");

		const zip = await JSZip.loadAsync(zipContent);
		const invalidFiles: string[] = [];
		const fileHashes: SHA256Hash[] = [];

		// Verify each file in manifest
		for (const fileEntry of manifest.files) {
			const file = zip.files[fileEntry.path];

			if (!file) {
				invalidFiles.push(`${fileEntry.path} (missing in ZIP)`);
				continue;
			}

			const content = await file.async("nodebuffer");
			const calculatedHash = this.hash.hashBuffer(content);

			if (!calculatedHash.equals(fileEntry.hash)) {
				invalidFiles.push(`${fileEntry.path} (hash mismatch)`);
			}

			fileHashes.push(calculatedHash);
		}

		// Verify Merkle root
		let merkleRootMatch = false;
		if (fileHashes.length === manifest.files.length) {
			const calculatedRoot = this.hash.buildMerkleRoot(fileHashes);
			merkleRootMatch = calculatedRoot.equals(manifest.merkleRoot);
		}

		const isValid = invalidFiles.length === 0 && merkleRootMatch;

		logger.info(
			{
				exportId: manifest.exportId,
				isValid,
				invalidFileCount: invalidFiles.length,
				merkleRootMatch,
			},
			"Manifest verification complete",
		);

		return {
			isValid,
			invalidFiles,
			merkleRootMatch,
		};
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const manifestBuilder = new ManifestBuilder();
