/**
 * Timestamp Service Domain Service
 * Manages RFC 3161 trusted timestamping
 */
import { createLogger } from "@/lib/logger";
import { AuditManifest, RFC3161Timestamp, SHA256Hash } from "./models";
import { timestampProvider, type ITimestampProvider } from "../infrastructure/crypto/timestamp-provider";
import { hashProvider, type IHashProvider } from "../infrastructure/crypto/hash-provider";

const logger = createLogger("TimestampService");

// ============================================
// INTERFACE
// ============================================

export interface ITimestampService {
	/**
	 * Timestamp a manifest hash
	 */
	timestampManifest(manifestHash: SHA256Hash): Promise<RFC3161Timestamp>;

	/**
	 * Verify a timestamp token
	 */
	verifyTimestamp(timestamp: RFC3161Timestamp, manifestHash: SHA256Hash): Promise<{
		isValid: boolean;
		timestampedAt: Date;
		authority: string;
	}>;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class TimestampService implements ITimestampService {
	constructor(
		private readonly tsa: ITimestampProvider = timestampProvider,
		private readonly hash: IHashProvider = hashProvider,
	) {}

	/**
	 * Request RFC 3161 timestamp for manifest hash
	 */
	async timestampManifest(manifestHash: SHA256Hash): Promise<RFC3161Timestamp> {
		logger.info(
			{ manifestHash: manifestHash.toString().substring(0, 16) },
			"Requesting timestamp for manifest",
		);

		const timestamp = await this.tsa.timestamp(manifestHash);

		logger.info(
			{
				manifestHash: manifestHash.toString().substring(0, 16),
				timestampedAt: timestamp.getTimestamp().toISOString(),
				authority: timestamp.getAuthority(),
			},
			"Timestamp obtained successfully",
		);

		return timestamp;
	}

	/**
	 * Verify timestamp token
	 */
	async verifyTimestamp(
		timestamp: RFC3161Timestamp,
		manifestHash: SHA256Hash,
	): Promise<{
		isValid: boolean;
		timestampedAt: Date;
		authority: string;
	}> {
		logger.info(
			{
				manifestHash: manifestHash.toString().substring(0, 16),
				authority: timestamp.getAuthority(),
			},
			"Verifying timestamp",
		);

		const isValid = await this.tsa.verifyBasic(timestamp, manifestHash);

		logger.info(
			{
				isValid,
				timestampedAt: timestamp.getTimestamp().toISOString(),
			},
			"Timestamp verification complete",
		);

		return {
			isValid,
			timestampedAt: timestamp.getTimestamp(),
			authority: timestamp.getAuthority(),
		};
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const timestampService = new TimestampService();
