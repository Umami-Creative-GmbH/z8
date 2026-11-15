// pnpm node docs/design/rollout-1692/1745/verify-root-normal.mjs <owned-private-fixture>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const directory = resolve(process.argv[2]);
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

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const observations = [];
  for (const [actor, route] of [["small-manager", "/en/time-tracking"], ["small-admin", "/en/analytics/vacation-trends"]]) {
    const context = await browser.createBrowserContext();
    await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
    await context.setCookie(...auth[actor].cookies);
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const pageErrors = [], consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(runtime.origin + route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (actor === "small-manager") await page.waitForSelector('header button[aria-label="Clock In"]');
    else await page.waitForSelector("table tbody tr");
    const observed = await page.evaluate(() => ({
      headings: [...document.querySelectorAll("h1")].map((node) => node.textContent.trim()),
      headerAriaHidden: document.querySelector("header")?.getAttribute("aria-hidden") ?? null,
      sidebarAriaHidden: document.querySelector('[data-slot="sidebar"]')?.getAttribute("aria-hidden") ?? null,
      selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((node) => node.textContent.trim()),
      columns: [...document.querySelectorAll("table thead th")].map((node) => node.textContent.trim()),
      rows: document.querySelectorAll("table tbody tr").length,
      missingAllowanceNotice: document.body.innerText.includes("Some employees have no stored allowance"),
    }));
    assert.equal(observed.headings.length, 1);
    assert.equal(observed.headerAriaHidden, null);
    assert.equal(observed.sidebarAriaHidden, null);
    if (actor === "small-admin") {
      assert.deepEqual(observed.headings, ["Vacation Trends"]);
      assert.deepEqual(observed.selectedTabs, ["Vacation Trends"]);
      assert.equal(observed.columns.length, 5);
      assert.equal(observed.rows, 8);
      assert.equal(observed.missingAllowanceNotice, true);
    }
    const probes = {};
    for (const name of ["get_compilation_issues", "get_errors"]) {
      const response = await fetch(runtime.origin + "/_next/mcp", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
        signal: AbortSignal.timeout(120_000),
      });
      assert.equal(response.status, 200);
      const raw = await response.text();
      const result = JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6) ?? raw);
      assert.ok(!result.result.isError);
      probes[name] = JSON.parse(result.result.content.find((item) => item.type === "text").text);
    }
    assert.deepEqual(probes.get_compilation_issues.issues, []);
    assert.deepEqual(probes.get_errors.configErrors, []);
    assert.deepEqual(probes.get_errors.sessionErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    observations.push({ actor, route, observed, pageErrors, consoleErrors, probes });
    await context.close();
  }
  const output = resolve("docs/design/rollout-1692/1745/root-review");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "normal-contexts.json"), JSON.stringify({ sourceCommit: "f9769a74353ac6670c4a36401029faf805b2a899", observations, boundary: "Fresh notification-denied contexts after preserving the prior dialog-session notices; no dialog interaction or native React instrumentation in these probes." }, null, 2) + "\n");
  console.log("Fresh clock and vacation contexts have clean browser/Next diagnostics and restored accessible shell attributes.");
} finally {
  await browser.close();
}
