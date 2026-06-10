/**
 * Manifest Builder Domain Service
 * Constructs audit manifests with per-file hashes and Merkle tree
 */
import JSZip from "jszip";
import { createLogger } from "@/lib/logger";
import { hashProvider, type IHashProvider } from "../infrastructure/crypto/hash-provider";
import { AuditFileEntry, AuditManifest, type SHA256Hash } from "./models";

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
		exportType: "data" | "payroll" | "audit_pack",
		zipContent: Buffer,
	): Promise<{
		manifest: AuditManifest;
		manifestHash: SHA256Hash;
	}>;

	/**
	 * Verify manifest against ZIP content
	 */
	verifyManifest(
		manifest: AuditManifest,
		zipContent: Buffer,
	): Promise<{
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
		exportType: "data" | "payroll" | "audit_pack",
		zipContent: Buffer,
	): Promise<{
		manifest: AuditManifest;
		manifestHash: SHA256Hash;
	}> {
		logger.info({ exportId, organizationId, exportType }, "Building audit manifest");

		// Load ZIP
		const zip = await JSZip.loadAsync(zipContent);

		// Get all file entries (excluding directories)
		const fileNames = Object.keys(zip.files)
			.filter((name) => !zip.files[name].dir)
			.sort(); // Sort for deterministic ordering

		const entries = await Promise.all(
			fileNames.map(async (fileName, merkleIndex) => {
				const file = zip.files[fileName];
				const content = await file.async("nodebuffer");
				const hash = this.hash.hashBuffer(content);

				return {
					fileEntry: new AuditFileEntry(fileName, hash, content.length, merkleIndex),
					hash,
				};
			}),
		);
		const fileEntries = entries.map((entry) => entry.fileEntry);
		const fileHashes = entries.map((entry) => entry.hash);

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
		const verifiedFiles = await Promise.all(
			manifest.files.map(async (fileEntry) => {
				const file = zip.files[fileEntry.path];

				if (!file) {
					return { invalidFile: `${fileEntry.path} (missing in ZIP)`, hash: null };
				}

				const content = await file.async("nodebuffer");
				const calculatedHash = this.hash.hashBuffer(content);

				if (!calculatedHash.equals(fileEntry.hash)) {
					return { invalidFile: `${fileEntry.path} (hash mismatch)`, hash: calculatedHash };
				}

				return { invalidFile: null, hash: calculatedHash };
			}),
		);
		const invalidFiles = verifiedFiles.flatMap((file) =>
			file.invalidFile ? [file.invalidFile] : [],
		);
		const fileHashes = verifiedFiles.flatMap((file) => (file.hash ? [file.hash] : []));

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
