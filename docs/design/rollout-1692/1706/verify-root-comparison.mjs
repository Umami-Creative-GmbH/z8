// Real-browser layout regression: pnpm node <this-file> <owned-fixture> <before|after>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const [fixtureInput, phase = "after"] = process.argv.slice(2);
assert.ok(["before", "after"].includes(phase));
const directory = resolve(fixtureInput);
const output = resolve("docs/design/rollout-1692/1706/root-review");
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
const { Client } = createRequire(resolve("apps/webapp/package.json"))("pg");
const database = new Client({ connectionString: runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL });
await database.connect();
assert.equal((await database.query("select current_database() name")).rows[0].name, runtime.env.POSTGRES_DB);
const actor = fixture.actors["small-employee"];
const original = (await database.query('select u.id,u.name,u.email from "user" u join employee e on e.user_id=u.id where e.id=$1 and e.organization_id=$2', [actor.employeeId, actor.organizationId])).rows[0];
assert.equal(original.email, actor.email);
const longName = "Alexandria Verylongfamilynamewithoutwordbreaksforcomparison Verification";
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const observations = [], errors = [];
let renamed = false;
await mkdir(output, { recursive: true });
try {
  const context = await browser.createBrowserContext();
  await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
  await context.setCookie(...auth["small-admin"].cookies);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setViewport({ width: 1600, height: 1000 });
  const click = async (name, selector = "button") => {
    const handle = await page.waitForFunction((name, selector) => [...document.querySelectorAll(selector)].find(element => element.getClientRects().length && (element.textContent.trim() === name || element.getAttribute("aria-label") === name)), {}, name, selector);
    await handle.asElement().focus();
    await page.keyboard.press("Enter");
    await handle.dispose();
  };
  await page.goto(runtime.origin + "/en/analytics/work-hours", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector('section[aria-label="Employee Work Hours"] tbody tr');
  await click("Period");
  await click("Last Year", '[role="option"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="Period"]')?.textContent.trim() === "Last Year" && document.querySelector('section[aria-label="Employee Work Hours"] tbody tr') && !document.querySelector('[aria-label="Loading work hours analytics data"]'));
  await click("Account: Person 0");
  await click("Font size", '[role="menuitem"]');
  await click("Large", '[role="menuitemradio"]');
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector('section[aria-label="Employee Work Hours"] tbody tr');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), "18px");
  const lastYear = async () => {
    await click("Period");
    await click("Last Year", '[role="option"]');
    await page.waitForFunction(() => document.querySelector('section[aria-label="Employee Work Hours"]')?.textContent.includes("2,088.0h") && document.querySelector('[aria-label="Period"]')?.textContent.trim() === "Last Year");
  };
  await lastYear();

  for (const nameMode of ["original", "long-name"]) {
    if (nameMode === "long-name") {
      assert.equal((await database.query('update "user" u set name=$1 where u.id=$2 and u.email=$3 and exists(select 1 from employee e where e.user_id=u.id and e.id=$4 and e.organization_id=$5)', [longName, original.id, original.email, actor.employeeId, actor.organizationId])).rowCount, 1);
      renamed = true;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(name => [...document.querySelectorAll('section[aria-label="Employee Work Hours"] tbody td:first-child')].some(cell => cell.textContent === name), {}, longName);
      await lastYear();
    }
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 844 });
      const region = await page.$('section[aria-label="Employee Work Hours"]');
      await region.evaluate(element => element.scrollIntoView({ block: "center" }));
      await region.evaluate(element => element.focus({ preventScroll: true }));
      // Arrow keys drive horizontal scrolling without End's page-scroll behavior.
      for (let step = 0; step < 60; step++) {
        if (await region.evaluate(element => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)) break;
        await page.keyboard.press("ArrowRight");
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      }
      await page.waitForFunction(() => { const element = document.querySelector('section[aria-label="Employee Work Hours"]'); return Math.abs(element.scrollLeft + element.clientWidth - element.scrollWidth) < 2; });
      await region.evaluate(element => element.scrollIntoView({ block: "center" }));
      const result = await region.evaluate(async element => {
        const bounds = element.getBoundingClientRect();
        const identity = element.querySelector("tbody td").getBoundingClientRect();
        const visibleText = cell => {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          let node;
          const rectangles = [];
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              const x = [rect.left + 1, (rect.left + rect.right) / 2, rect.right - 1];
              const y = (rect.top + rect.bottom) / 2;
              rectangles.push({ left: rect.left, right: rect.right, visible: rect.left >= identity.right - 1 && rect.right <= bounds.right + 1 && x.every(point => cell.contains(document.elementFromPoint(point, y))) });
            }
          }
          return { text: cell.textContent.trim(), rectangles, fullyVisible: rectangles.length > 0 && rectangles.every(rectangle => rectangle.visible) };
        };
        const statusHeader = visibleText(element.querySelector("thead th:last-child"));
        const statuses = [...element.querySelectorAll("tbody td:last-child")].filter(cell => { const rect = cell.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }).map(visibleText);
        const metrics = [];
        for (let column = 1; column <= 3; column++) {
          const header = element.querySelectorAll("thead th")[column];
          element.scrollLeft += header.getBoundingClientRect().right - bounds.right;
          await new Promise(resolve => requestAnimationFrame(resolve));
          metrics.push({ header: visibleText(header), value: visibleText(element.querySelectorAll("tbody tr:first-child td")[column]) });
        }
        element.scrollLeft = element.scrollWidth;
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { regionWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft, regionLeft: bounds.left, identityLeft: identity.left, identityWidth: identity.width, statusHeader, statuses, metrics, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
      });
      observations.push({ nameMode, width, ...result });
      await page.screenshot({ path: join(output, `${phase}-${nameMode}-${width}.png`), fullPage: true });
    }
  }
  await writeFile(join(output, `${phase}-readability.json`), JSON.stringify({ phase, observations, errors, boundary: "Actual authorized report records and saved 18px text; one owned synthetic employee is temporarily renamed and restored. Native arrow-key scroll, DOM text ranges and hit-testing detect pinned-column occlusion. Screenshots retain any failure." }, null, 2) + "\n");
  assert.deepEqual(errors, []);
  for (const result of observations) {
    assert.equal(result.pageWidth, result.viewportWidth);
    assert.ok(Math.abs(result.identityLeft - result.regionLeft) < 2);
    assert.ok(result.statusHeader.fullyVisible && result.statuses.length > 0 && result.statuses.every(status => status.fullyVisible), `Status text is occluded: ${result.nameMode}, ${result.width}px`);
    assert.ok(result.metrics.every(metric => metric.header.fullyVisible && metric.value.fullyVisible), `Numeric comparison text is occluded: ${result.nameMode}, ${result.width}px`);
  }
  console.log(`Verified ${observations.length} real phone comparisons with original/long names and saved 18px text.`);
} finally {
  if (renamed) assert.equal((await database.query('update "user" u set name=$1 where u.id=$2 and u.name=$3 and exists(select 1 from employee e where e.user_id=u.id and e.id=$4 and e.organization_id=$5)', [original.name, original.id, longName, actor.employeeId, actor.organizationId])).rowCount, 1);
  await browser.close();
  await database.end();
}
