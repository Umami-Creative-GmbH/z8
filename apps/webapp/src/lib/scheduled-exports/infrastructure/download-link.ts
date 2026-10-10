/**
 * Download Link
 *
 * Signs a scheduled export's download URL together with its expiry (#1008).
 */
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { getDefaultPresignedUrlTtlSeconds, getPresignedUrl } from "@/lib/storage/export-s3-client";
import type { SignedDownloadLink } from "../domain/types";

/**
 * Presigns `s3Key` for `lifetimeSeconds`, the private storage default unless
 * given. The expiry is read before signing and floored to the second, so it is
 * never later than the URL's own.
 */
export async function signDownloadLink(
	organizationId: string,
	s3Key: string,
	lifetimeSeconds = getDefaultPresignedUrlTtlSeconds(),
	clock: Clock = systemClock,
): Promise<SignedDownloadLink> {
	const signedAt = clock.nowInstant().round({ smallestUnit: "second", roundingMode: "floor" });
	const url = await getPresignedUrl(organizationId, s3Key, lifetimeSeconds);
	return { url, lifetimeSeconds, expiresAt: signedAt.add({ seconds: lifetimeSeconds }) };
}
