// pnpm node docs/design/rollout-1692/1703/verify-unassigned-manager.mjs <owned-private-fixture>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const directory = resolve(process.argv[2]);
const output = resolve("docs/design/rollout-1692/1703");
const json = async (name) => JSON.parse(await readFile(join(directory, name), "utf8"));
const runtime = await json("runtime-private.json");
const fixture = await json("fixture-private.json");
const services = await json("services.json");
const auth = await json("dev-auth-private.json");
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for (const container of services.containers) {
  assert.equal(execFileSync("docker", ["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', container], { encoding: "utf8", windowsHide: true }).trim(), services.label);
}

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const context = await browser.createBrowserContext();
  await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
  await context.setCookie(...auth["small-admin"].cookies);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`${runtime.origin}/en/analytics/overtime-burn-down`, { waitUntil: "networkidle0", timeout: 120_000 });
  await page.waitForSelector("dl");
  const control = await page.$('[aria-label="Manager filter"]');
  assert.ok(control);
  await control.click();
  await page.waitForSelector('[role="option"]');
  const option = await page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')].find((element) => element.getClientRects().length && element.textContent.trim() === "Unassigned"));
  assert.ok(option.asElement());
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.request().headers()["next-action"] && response.request().postData()?.includes('"unassigned"'));
  await option.asElement().click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const actionBody = await response.text();
  assert.ok(actionBody.includes('"success":true'));
  assert.ok(!actionBody.includes('"success":false'));
  await page.waitForFunction(() => document.querySelector('[aria-label="Manager filter"]')?.textContent.includes("Unassigned") && document.querySelector("dl") && !document.querySelector('[aria-label="Loading overtime data"]'));
  const observed = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("h1")].map((element) => element.textContent.trim()),
    organization: document.querySelector('[aria-label^="Switch Organization"]')?.getAttribute("aria-label"),
    period: document.querySelector('[aria-label="Period"]')?.textContent.trim(),
    manager: document.querySelector('[aria-label="Manager filter"]')?.textContent.trim(),
    columns: [...document.querySelectorAll("table thead th")].map((element) => element.textContent.trim()),
    rows: [...document.querySelectorAll("table tbody tr")].map((element) => element.innerText),
    retryVisible: [...document.querySelectorAll("button")].some((element) => element.textContent.trim() === "Retry" && element.getClientRects().length),
    selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((element) => element.textContent.trim()),
  }));
  assert.deepEqual(observed.headings, ["Overtime Burn-Down"]);
  assert.equal(observed.manager, "Unassigned");
  assert.equal(observed.retryVisible, false);
  assert.equal(observed.columns.length, 5);
  assert.deepEqual(observed.selectedTabs, ["Overtime Burn-Down"]);
  assert.equal(observed.organization, "Switch Organization: Performance small");
  assert.equal(pageErrors.length, 0);
  await page.screenshot({ path: join(output, "unassigned-manager-fixed.png") });

  const navigation = [];
  for (const [label, pathname] of [["Overview", "/en/analytics"], ["Overtime Burn-Down", "/en/analytics/overtime-burn-down"]]) {
    const link = await page.evaluateHandle((label) => [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.trim() === label), label);
    assert.ok(link.asElement());
    await link.asElement().click();
    await page.waitForFunction((pathname, label) => location.pathname === pathname && document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === label, {}, pathname, label);
    navigation.push({ pathname, selectedTab: label });
  }

  const rpc = async (method, params) => {
    const response = await fetch(`${runtime.origin}/_next/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(120_000),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    return JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6) ?? raw);
  };
  const tools = await rpc("tools/list");
  assert.ok(tools.result.tools.some((tool) => tool.name === "get_compilation_issues"));
  const probes = {};
  for (const name of ["get_compilation_issues", "get_errors"]) {
    const result = await rpc("tools/call", { name, arguments: {} });
    assert.ok(!result.result.isError);
    probes[name] = JSON.parse(result.result.content.find((item) => item.type === "text").text);
  }
  assert.deepEqual(probes.get_compilation_issues.issues, []);
  assert.deepEqual(probes.get_errors.configErrors, []);
  assert.deepEqual(probes.get_errors.sessionErrors, []);
  const routes = await rpc("tools/call", { name: "get_routes", arguments: {} });
  assert.ok(JSON.stringify(routes).includes("overtime-burn-down"));
  await writeFile(join(output, "unassigned-manager-fixed.json"), JSON.stringify({
    actor: "small-admin", route: "/en/analytics/overtime-burn-down", viewport: { width: 1600, height: 1000 },
    action: { httpStatus: response.status(), success: true }, observed, navigation, pageErrors, probes,
    boundary: "Real authorized action and unchanged generated fixture data; no response substitution. Native browser inspection also observed the prior visibility-query failure. Native React inspection timed out; this does not certify React performance or the broader transition matrix.",
  }, null, 2) + "\n");
  console.log("Unassigned manager action succeeded; five-column records and connected Next diagnostics verified.");
} finally {
  await browser.close();
}
