/**
 * RFC 3161 Timestamp Provider
 * Infrastructure layer implementation for trusted timestamping
 *
 * Uses FreeTSA.org as the default timestamp authority
 * https://freetsa.org/index_en.php
 */
import crypto from "node:crypto";
import { createLogger } from "@/lib/logger";
import { SHA256Hash, RFC3161Timestamp } from "../../domain/models";

const logger = createLogger("TimestampProvider");

// ============================================
// INTERFACE
// ============================================

export interface ITimestampProvider {
	/**
	 * Request a trusted timestamp for a hash
	 */
	timestamp(dataHash: SHA256Hash): Promise<RFC3161Timestamp>;

	/**
	 * Verify a timestamp token (basic verification)
	 * Note: Full verification requires TSA certificate chain validation
	 */
	verifyBasic(timestamp: RFC3161Timestamp, dataHash: SHA256Hash): Promise<boolean>;
}

// ============================================
// IMPLEMENTATION
// ============================================

/**
 * FreeTSA.org timestamp provider
 *
 * FreeTSA is a free RFC 3161 compliant Time Stamp Authority.
 * It provides legally valid timestamps for non-commercial use.
 */
export class FreeTSATimestampProvider implements ITimestampProvider {
	private readonly tsaUrl = "https://freetsa.org/tsr";
	private readonly authority = "freetsa.org";
	private readonly maxRetries = 3;
	private readonly retryDelayMs = 1000;

	/**
	 * Request a timestamp from FreeTSA
	 */
	async timestamp(dataHash: SHA256Hash): Promise<RFC3161Timestamp> {
		const hashBuffer = Buffer.from(dataHash.toString(), "hex");

		// Build RFC 3161 TimeStampReq
		const tsRequest = this.buildTimestampRequest(hashBuffer);

		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
			try {
				logger.info(
					{ attempt, maxRetries: this.maxRetries, hash: dataHash.toString().substring(0, 16) },
					"Requesting timestamp from FreeTSA",
				);

				const response = await fetch(this.tsaUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/timestamp-query",
					},
					body: new Uint8Array(tsRequest),
					signal: AbortSignal.timeout(15000), // 15 second timeout
				});

				if (!response.ok) {
					throw new Error(`TSA request failed: ${response.status} ${response.statusText}`);
				}

				const responseBuffer = Buffer.from(await response.arrayBuffer());

				// Parse response to extract timestamp
				const timestamp = this.parseTimestampResponse(responseBuffer);
				const tokenBase64 = responseBuffer.toString("base64");

				logger.info(
					{ timestamp: timestamp.toISOString(), hash: dataHash.toString().substring(0, 16) },
					"Timestamp obtained successfully",
				);

				return new RFC3161Timestamp(tokenBase64, timestamp, this.authority);
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				logger.warn(
					{ attempt, error: lastError.message },
					"Timestamp request failed, retrying...",
				);

				if (attempt < this.maxRetries) {
					await this.delay(this.retryDelayMs * attempt);
				}
			}
		}

		throw new Error(`Timestamp request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
	}

	/**
	 * Basic verification of timestamp token
	 * Checks that the token contains the expected hash
	 *
	 * IMPORTANT: This is a basic verification that only checks if the hash
	 * appears in the timestamp response. For full RFC 3161 compliance and
	 * legal validity, you should implement proper verification that:
	 * 1. Parses the ASN.1 TimeStampToken structure
	 * 2. Validates the TSA's digital signature
	 * 3. Verifies the certificate chain
	 *
	 * Consider using a library like @peculiar/asn1-tsp for production use.
	 */
	async verifyBasic(timestamp: RFC3161Timestamp, dataHash: SHA256Hash): Promise<boolean> {
		try {
			const tokenBuffer = Buffer.from(timestamp.getToken(), "base64");
			const hashHex = dataHash.toString();

			// Simple check: the response should contain our hash
			// Full verification would require parsing ASN.1 and validating TSA signature
			const tokenHex = tokenBuffer.toString("hex");

			// The hash should appear in the timestamp response
			const hashFound = tokenHex.includes(hashHex);

			if (!hashFound) {
				logger.warn({ hashHex: hashHex.substring(0, 16) }, "Hash not found in timestamp token");
				return false;
			}

			// Verify timestamp is reasonable (not in future, not too old)
			const tsTime = timestamp.getTimestamp();
			const now = new Date();
			const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
			const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

			if (tsTime > now) {
				logger.warn({ timestamp: tsTime.toISOString() }, "Timestamp is in the future");
				return false;
			}

			if (tsTime < oneYearAgo) {
				logger.warn({ timestamp: tsTime.toISOString() }, "Timestamp is older than 1 year");
				// Note: old timestamps may still be valid, just log a warning
			}

			return true;
		} catch (error) {
			logger.error({ error: error instanceof Error ? error.message : String(error) }, "Timestamp verification failed");
			return false;
		}
	}

	/**
	 * Build RFC 3161 TimeStampReq
	 *
	 * Simplified implementation that creates a valid request.
	 * For production, consider using a proper ASN.1 library like @peculiar/asn1-tsp
	 */
	private buildTimestampRequest(hashBuffer: Buffer): Buffer {
		// TimeStampReq ::= SEQUENCE {
		//   version                  INTEGER { v1(1) },
		//   messageImprint           MessageImprint,
		//   reqPolicy                TSAPolicyId OPTIONAL,
		//   nonce                    INTEGER OPTIONAL,
		//   certReq                  BOOLEAN DEFAULT FALSE,
		//   extensions               [0] IMPLICIT Extensions OPTIONAL
		// }
		//
		// MessageImprint ::= SEQUENCE {
		//   hashAlgorithm            AlgorithmIdentifier,
		//   hashedMessage            OCTET STRING
		// }

		// SHA-256 OID: 2.16.840.1.101.3.4.2.1
		const sha256Oid = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

		// Build AlgorithmIdentifier for SHA-256
		const algIdContent = Buffer.concat([
			Buffer.from([0x06, sha256Oid.length]), // OID tag + length
			sha256Oid,
			Buffer.from([0x05, 0x00]), // NULL parameters
		]);
		const algId = Buffer.concat([
			Buffer.from([0x30, algIdContent.length]), // SEQUENCE tag + length
			algIdContent,
		]);

		// Build MessageImprint
		const hashedMessage = Buffer.concat([
			Buffer.from([0x04, hashBuffer.length]), // OCTET STRING tag + length
			hashBuffer,
		]);
		const messageImprintContent = Buffer.concat([algId, hashedMessage]);
		const messageImprint = Buffer.concat([
			Buffer.from([0x30, messageImprintContent.length]), // SEQUENCE tag + length
			messageImprintContent,
		]);

		// Build version INTEGER { v1(1) }
		const version = Buffer.from([0x02, 0x01, 0x01]);

		// Build nonce (random 8 bytes)
		const nonceValue = crypto.randomBytes(8);
		const nonce = Buffer.concat([
			Buffer.from([0x02, nonceValue.length]), // INTEGER tag + length
			nonceValue,
		]);

		// Build certReq BOOLEAN TRUE
		const certReq = Buffer.from([0x01, 0x01, 0xff]);

		// Build TimeStampReq SEQUENCE
		const reqContent = Buffer.concat([version, messageImprint, nonce, certReq]);
		const request = Buffer.concat([
			Buffer.from([0x30, reqContent.length]), // SEQUENCE tag + length
			reqContent,
		]);

		return request;
	}

	/**
	 * Parse timestamp from response
	 * Extracts the genTime from the TSTInfo structure
	 */
	private parseTimestampResponse(response: Buffer): Date {
		// TimeStampResp ::= SEQUENCE {
		//   status                  PKIStatusInfo,
		//   timeStampToken          TimeStampToken OPTIONAL
		// }
		//
		// The timestamp is in timeStampToken.content.encapContentInfo.eContent (TSTInfo)
		// TSTInfo.genTime is a GeneralizedTime string

		// Simple approach: search for GeneralizedTime (tag 0x18)
		// GeneralizedTime format: YYYYMMDDHHMMSSZ
		const hex = response.toString("hex");

		// Look for GeneralizedTime tag (0x18) followed by length 15 (0x0f)
		const genTimePattern = /18(?:0f|0d)([0-9a-f]{26,30})/i;
		const match = hex.match(genTimePattern);

		if (match) {
			const genTimeHex = match[1];
			const genTimeStr = Buffer.from(genTimeHex, "hex").toString("ascii");

			// Parse YYYYMMDDHHMMSS[.fff]Z format
			const year = parseInt(genTimeStr.substring(0, 4), 10);
			const month = parseInt(genTimeStr.substring(4, 6), 10) - 1;
			const day = parseInt(genTimeStr.substring(6, 8), 10);
			const hour = parseInt(genTimeStr.substring(8, 10), 10);
			const minute = parseInt(genTimeStr.substring(10, 12), 10);
			const second = parseInt(genTimeStr.substring(12, 14), 10);

			return new Date(Date.UTC(year, month, day, hour, minute, second));
		}

		// Timestamp parsing failed - this is critical for audit integrity
		// Do NOT fallback to current time as that defeats the purpose of trusted timestamping
		throw new Error(
			"Failed to parse timestamp from TSA response. The timestamp is required for audit trail validity.",
		);
	}

	/**
	 * Delay helper for retries
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const timestampProvider = new FreeTSATimestampProvider();
