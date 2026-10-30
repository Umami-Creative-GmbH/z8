/** Dedicated native Chrome/CDP fixture; does not alter the browser's UA or webdriver properties. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { localOrigin } from "./analytics-consent-fixture.mjs";

export function representativeChromePlan({
	profile,
	profileRoot,
	port,
	sinkOrigin,
}) {
	const location = relative(resolve(profileRoot), resolve(profile));
	if (
		!location.startsWith("owned-") ||
		location.includes("..") ||
		location.includes("/") ||
		location.includes("\\") ||
		!Number.isInteger(port) ||
		port < 1024 ||
		port > 65535
	)
		throw new Error(
			"Dedicated owned profile and nonzero private debugging port required.",
		);
	localOrigin(sinkOrigin);
	return [
		`--user-data-dir=${resolve(profile)}`,
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${port}`,
		`--proxy-server=${sinkOrigin}`,
		"--proxy-bypass-list=localhost;127.0.0.1",
		"--disable-quic",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-sync",
		"--disable-default-apps",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
		"--disable-backgrounding-occluded-windows",
		"--disable-features=AutofillServerCommunication,CalculateNativeWinOcclusion",
		"--window-position=-32000,-32000",
		"--window-size=1280,900",
		"about:blank",
	];
}
function powershell(script) {
	return execFileSync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", script],
		{ encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
	).trim();
}
const encoded = (value) =>
	Buffer.from(JSON.stringify(value)).toString("base64");
const decode =
	"$spec1470 = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function openRepresentativeChrome({
	directory,
	sinkOrigin,
	executablePath,
	puppeteer,
}) {
	if (process.platform !== "win32")
		throw new Error("This owned native Chrome launcher requires Windows.");
	const profileRoot = join(resolve(directory), "browser-profiles");
	await mkdir(profileRoot, { recursive: true });
	const profile = await mkdtemp(join(profileRoot, "owned-"));
	const reservation = createServer();
	await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const args = representativeChromePlan({
		profile,
		profileRoot,
		port,
		sinkOrigin,
	});
	const spec = encoded({
		executable: executablePath,
		args: args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`),
	});
	const pid = Number(
		powershell(
			`${decode}${spec}'))); $child1470 = Start-Process -FilePath $spec1470.executable -ArgumentList $spec1470.args -WindowStyle Hidden -PassThru; Write-Output $child1470.Id`,
		),
	);
	if (!Number.isInteger(pid) || pid <= 0)
		throw new Error("Owned browser PID unavailable.");
	const owner = {
		pid,
		profile,
		port,
		executablePath,
		args,
		kind: "owned-native-sdk-chrome-1470",
	};
	await writeFile(
		join(profile, "owner-private.json"),
		JSON.stringify(owner, null, 2),
		{ mode: 0o600 },
	);
	async function ownership() {
		const value = encoded({ pid, profile });
		return JSON.parse(
			powershell(
				`${decode}${value}'))); $process1470 = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $spec1470.pid); if ($null -eq $process1470) { Write-Output '{"alive":false,"owned":false}' } else { $valid1470 = $process1470.CommandLine.Contains($spec1470.profile) -and $process1470.CommandLine.Contains('--remote-debugging-port='); @{ alive=$true; owned=$valid1470 } | ConvertTo-Json -Compress }`,
			),
		);
	}
	async function closeProof() {
		for (let attempt = 0; attempt < 20; attempt++) {
			const state = await ownership();
			if (!state.alive) {
				await writeFile(
					join(profile, "closed-private.json"),
					JSON.stringify({ pidClosed: true, profileRetained: true }),
					{ mode: 0o600 },
				);
				return;
			}
			if (!state.owned)
				throw new Error(
					"Owned browser PID/profile proof lost; no process was stopped.",
				);
			await pause(100);
		}
		const value = encoded({ pid, profile });
		powershell(
			`${decode}${value}'))); $process1470 = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $spec1470.pid); if ($null -ne $process1470 -and $process1470.CommandLine.Contains($spec1470.profile)) { Stop-Process -Id $spec1470.pid -Force }`,
		);
		await writeFile(
			join(profile, "closed-private.json"),
			JSON.stringify({ ownedPidStopped: true, profileRetained: true }),
			{ mode: 0o600 },
		);
	}
	try {
		const proof = await ownership();
		if (!proof.alive || !proof.owned)
			throw new Error("Owned browser PID/profile preflight failed.");
		let version;
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
					signal: AbortSignal.timeout(500),
				});
				if (response.ok) {
					version = await response.json();
					break;
				}
			} catch {}
			await pause(100);
		}
		if (!version?.webSocketDebuggerUrl)
			throw new Error("Owned native Chrome debugging endpoint unavailable.");
		const endpoint = new URL(version.webSocketDebuggerUrl);
		if (endpoint.hostname !== "127.0.0.1" || Number(endpoint.port) !== port)
			throw new Error("Debugging endpoint escaped owned loopback port.");
		const browser = await puppeteer.connect({
			browserWSEndpoint: endpoint.href,
		});
		return {
			browser,
			owner: { ...owner, binaryVersion: version.Browser },
			closeProof,
		};
	} catch (error) {
		await closeProof();
		throw error;
	}
}
