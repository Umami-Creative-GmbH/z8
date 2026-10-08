import { readFile } from "node:fs/promises";
export function httpsUrl(value, name, allowSearch = false) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(name + " must be a valid HTTPS URL.");
	}
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.hash ||
		(!allowSearch && url.search)
	) {
		throw new Error(
			name + " must use trusted HTTPS without credentials or a fragment.",
		);
	}
	return url;
}
export async function readVersion(file) {
	let parsed;
	try {
		parsed = JSON.parse(await readFile(file, "utf8"));
	} catch {
		throw new Error("Release version file is unreadable.");
	}
	if (
		!parsed ||
		typeof parsed.version !== "string" ||
		!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(parsed.version)
	) {
		throw new Error("A valid desktop release version is required.");
	}
	return parsed.version;
}
