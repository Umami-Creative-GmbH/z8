/**
 * Signed File URL
 *
 * Presigns the URL of a run's stored file together with its expiry (#1008).
 * Not a download link: that is #988's code-guarded URL for external recipients.
 */
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { getDefaultPresignedUrlTtlSeconds, getPresignedUrl } from "@/lib/storage/export-s3-client";
import type { SignedFileUrl } from "../domain/types";

/**
 * Presigns `s3Key` for `lifetimeSeconds`, the private storage default unless
 * given. The expiry is read before signing and floored to the second, so it is
 * never later than the URL's own.
 */
export async function signFileUrl(
	organizationId: string,
	s3Key: string,
	lifetimeSeconds = getDefaultPresignedUrlTtlSeconds(),
	clock: Clock = systemClock,
): Promise<SignedFileUrl> {
	const signedAt = clock.nowInstant().round({ smallestUnit: "second", roundingMode: "floor" });
	const url = await getPresignedUrl(organizationId, s3Key, lifetimeSeconds);
	return { url, lifetimeSeconds, expiresAt: signedAt.add({ seconds: lifetimeSeconds }) };
}
