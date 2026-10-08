import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
const browser = await puppeteer.connect({
	browserURL: "http://127.0.0.1:9227",
	defaultViewport: null,
});
const page = (await browser.pages())[0];
page.on("pageerror", (error) => console.error("WebView error:", error.message));
const invoke = (command, args = {}) =>
	page.evaluate(
		(command, args) => window.__TAURI_INTERNALS__.invoke(command, args),
		command,
		args,
	);
async function serverState() {
	const response = await fetch("http://127.0.0.1:9231/__qa/state");
	if (!response.ok) throw new Error("QA state request failed");
	return response.json();
}
const waitButton = async (name) => {
	await page.waitForFunction(
		(name) =>
			[...document.querySelectorAll("button")].some(
				(button) =>
					button.getAttribute("aria-label") === name && !button.disabled,
			),
		{ timeout: 45000 },
		name,
	);
	return "button[aria-label='" + name + "']";
};
try {
	if (process.argv[2] === "lost-reply") {
		const settings = await invoke("get_settings");
		await invoke("save_settings", { ...settings, language: "en" });
		await page.reload();
		await waitButton("Clock out");
		const before = await serverState();
		await fetch("http://127.0.0.1:9231/__qa/drop-reply");
		await page.click(await waitButton("Clock out"));
		await page.waitForSelector("button[aria-label='Clock in']");
		await invoke("sync_clock_commands", { force: true });
		const after = await serverState();
		assert.equal(after.receipts.length, before.receipts.length + 1);
		assert.equal(after.liveWork, null);
		const journal = await invoke("sync_clock_commands", { force: true });
		assert.equal(
			journal.commands.filter((command) => command.state === "pending").length,
			0,
		);
		console.log(
			"Native IPC: committed close with lost response was resolved by receipt lookup without duplicate work.",
		);
		await browser.disconnect();
		process.exit(0);
	}
	if (process.argv[2] === "restart") {
		await waitButton("Resume work");
		const inventory = await invoke("get_organizations");
		assert.equal(inventory.cached, true);
		assert.equal(inventory.activeOrganizationId, "native-qa-org");
		const before = await invoke("sync_clock_commands", { force: false });
		assert.equal(before.onBreak, true);
		await page.screenshot({ path: resolve(".native-qa/offline-restart.png") });
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll("button")].some(
					(button) => button.textContent === "End day" && !button.disabled,
				),
			{ timeout: 45000 },
		);
		await page.evaluate(() => {
			const button = [...document.querySelectorAll("button")].find(
				(button) => button.textContent === "End day" && !button.disabled,
			);
			if (!button) throw new Error("End Day is unavailable");
			button.click();
		});
		await page.waitForSelector("button[aria-label='Clock in']");
		const ended = await invoke("sync_clock_commands", { force: false });
		assert.equal(ended.onBreak, false);
		assert.equal(ended.commands.length, before.commands.length);
		await page.click(await waitButton("Clock in"));
		await page.waitForSelector("button[aria-label='Clock out']");
		const resumed = await invoke("sync_clock_commands", { force: false });
		assert.equal(
			resumed.commands.filter((command) => command.state === "pending").length,
			2,
		);
		await fetch("http://127.0.0.1:9231/__qa/offline?value=false");
		await invoke("sync_clock_commands", { force: true });
		await invoke("get_clock_status");
		await page.reload();
		await page.waitForSelector("button[aria-label='Clock out']");
		const synced = await invoke("sync_clock_commands", { force: true });
		assert.equal(
			synced.commands.filter((command) => command.state === "pending").length,
			0,
		);
		console.log(
			"Native IPC: disconnected restart, scoped break restoration, End Day without another write, offline clock-in and ordered reconnection passed.",
		);
		await page.click("button[aria-label='Open settings']");
		await page.waitForSelector("dialog[open]");
		await page.keyboard.press("Escape");
		assert.equal(
			await page.evaluate(() =>
				document.activeElement.getAttribute("aria-label"),
			),
			"Open settings",
		);
		const settings = await invoke("get_settings");
		await invoke("save_settings", { ...settings, language: "de" });
		await page.reload();
		await page.waitForSelector("button[aria-label='Ausstempeln']");
		await page.screenshot({ path: resolve(".native-qa/german-working.png") });
		console.log(
			"Native WebView: settings Escape/focus restoration and German clock controls passed.",
		);
		await browser.disconnect();
		process.exit(0);
	}
	await page.click(await waitButton("Clock in"));
	await page.waitForSelector("button[aria-label='Clock out']");
	assert.equal((await invoke("get_clock_status")).isClockedIn, true);
	await fetch("http://127.0.0.1:9231/__qa/offline?value=true");
	await page.waitForFunction(() =>
		[...document.querySelectorAll("button")].some(
			(button) => button.textContent === "Start break" && !button.disabled,
		),
	);
	await page.evaluate(() => {
		const button = [...document.querySelectorAll("button")].find(
			(button) => button.textContent === "Start break" && !button.disabled,
		);
		if (!button) throw new Error("Start Break is unavailable");
		button.click();
	});
	await waitButton("Resume work");
	const journal = await invoke("sync_clock_commands", { force: false });
	assert.equal(journal.onBreak, true);
	assert.equal(
		journal.commands.filter((command) => command.state === "pending").length,
		1,
	);
	await page.screenshot({
		path: resolve(".native-qa/offline-manual-break.png"),
	});
	console.log(
		"Native IPC: online clock-in, offline Start Break and retained frozen close passed.",
	);
} finally {
	await browser.disconnect();
}
