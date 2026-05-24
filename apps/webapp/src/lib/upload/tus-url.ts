const TUS_API_PATH = "/api/tus/";

export function getTusFileKeyFromUploadUrl(uploadUrl: string | undefined): string | null {
	if (!uploadUrl) {
		return null;
	}

	try {
		const url = new URL(uploadUrl, "http://localhost");
		const tusPathIndex = url.pathname.indexOf(TUS_API_PATH);
		if (tusPathIndex === -1) {
			return null;
		}

		const encodedKey = url.pathname.slice(tusPathIndex + TUS_API_PATH.length);
		return encodedKey ? decodeURIComponent(encodedKey) : null;
	} catch {
		return null;
	}
}
