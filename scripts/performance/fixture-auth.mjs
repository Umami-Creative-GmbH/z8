import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

function readCookies(headers, origin, cookies = new Map()) {
	for (const header of headers.getSetCookie()) {
		const [pair, ...attributes] = header.split(";");
		const separator = pair.indexOf("=");
		const name = pair.slice(0, separator);
		const values = new Map(
			attributes.map((attribute) => {
				const [key, ...parts] = attribute.trim().split("=");
				return [key.toLowerCase(), parts.join("=")];
			}),
		);
		if (values.get("max-age") === "0") {
			cookies.delete(name);
			continue;
		}
		cookies.set(name, {
			name,
			value: pair.slice(separator + 1),
			domain: values.get("domain") || new URL(origin).hostname,
			path: values.get("path") || "/",
			httpOnly: values.has("httponly"),
			secure: values.has("secure"),
			...(values.get("samesite")
				? {
						sameSite:
							values.get("samesite").slice(0, 1).toUpperCase() +
							values.get("samesite").slice(1).toLowerCase(),
					}
				: {}),
		});
	}
	return cookies;
}

async function request(origin, path, input) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const response = await fetch(new URL(path, origin), {
			...input,
			signal: AbortSignal.timeout(15000),
		});
		if (response.status !== 429) return response;
		const retryAfter = response.headers.get("retry-after");
		const seconds =
			retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
				? Number(retryAfter)
				: retryAfter
					? (Date.parse(retryAfter) - Date.now()) / 1000
					: 10;
		if (!Number.isFinite(seconds) || seconds > 120)
			throw new Error(
				"Synthetic authentication retry delay is unavailable or exceeds the bounded fixture limit.",
			);
		await response.body?.cancel();
		await pause(Math.max(1000, seconds * 1000 + 200));
	}
	throw new Error("Synthetic authentication rate limit did not clear.");
}

/** The real Better Auth caller; no session minting or authorization bypass. */
export async function authenticateFixture(directory) {
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const fixture = JSON.parse(
		await readFile(join(directory, "fixture-private.json"), "utf8"),
	);
	if (
		fixture.kind !== "disposable" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(
			new URL(runtime.origin).hostname,
		)
	)
		throw new Error(
			"Synthetic authentication requires the local disposable fixture.",
		);
	const auth = {};
	for (const [name, actor] of Object.entries(fixture.actors)) {
		const signIn = await request(runtime.origin, "/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: runtime.origin },
			body: JSON.stringify({ email: actor.email, password: actor.password }),
		});
		if (!signIn.ok) throw new Error("Synthetic fixture sign-in failed.");
		const cookies = readCookies(signIn.headers, runtime.origin);
		const active = await request(
			runtime.origin,
			"/api/auth/organization/set-active",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: runtime.origin,
					Cookie: [...cookies.values()]
						.map((cookie) => `${cookie.name}=${cookie.value}`)
						.join("; "),
				},
				body: JSON.stringify({ organizationId: actor.organizationId }),
			},
		);
		if (!active.ok)
			throw new Error("Synthetic fixture organization activation failed.");
		readCookies(active.headers, runtime.origin, cookies);
		auth[name] = {
			employeeId: actor.employeeId,
			cookies: [...cookies.values()],
		};
		await writeFile(
			join(directory, "auth-private.json"),
			JSON.stringify(auth, null, 2),
			{ mode: 0o600 },
		);
	}
	console.log(
		`Private authentication prepared for ${Object.keys(auth).length} synthetic actors.`,
	);
}
