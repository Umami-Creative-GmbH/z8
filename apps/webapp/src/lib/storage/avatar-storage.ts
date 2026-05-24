import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { S3_PUBLIC_BUCKET, S3_PUBLIC_URL, s3Client } from "@/lib/storage/s3-client";

export function createAvatarStorageKey(userId: string, id = nanoid()): string {
	return `avatars/${userId}/${id}.webp`;
}

export function getOwnedAvatarKeyFromPublicUrl(
	url: string | null | undefined,
	userId: string,
): string | null {
	if (!url) {
		return null;
	}

	try {
		const publicUrl = new URL(S3_PUBLIC_URL);
		const avatarUrl = new URL(url);

		if (avatarUrl.origin !== publicUrl.origin) {
			return null;
		}

		const publicPath = publicUrl.pathname.replace(/\/$/, "");
		if (publicPath && !avatarUrl.pathname.startsWith(`${publicPath}/`)) {
			return null;
		}

		const key = decodeURIComponent(avatarUrl.pathname.slice(publicPath.length).replace(/^\//, ""));
		if (key.includes("..") || key.includes("\\")) {
			return null;
		}

		if (key.startsWith(`avatars/${userId}/`) || key.startsWith(`avatars/${userId}-`)) {
			return key;
		}
	} catch {
		return null;
	}

	return null;
}

export async function deleteOwnedAvatarObject(
	url: string | null | undefined,
	userId: string,
): Promise<void> {
	const key = getOwnedAvatarKeyFromPublicUrl(url, userId);
	if (!key) {
		return;
	}

	try {
		await s3Client.send(new DeleteObjectCommand({ Bucket: S3_PUBLIC_BUCKET, Key: key }));
	} catch (error) {
		console.error("Failed to delete previous avatar object", error);
	}
}
