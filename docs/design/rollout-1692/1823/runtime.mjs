/**
 * pnpm node docs/design/rollout-1692/1823/runtime.mjs <private-fixture> <before|after|final|continuation> [baseline-ref]
 * Requires this checkout's owned runtime and isolated native agent-browser session.
 * Codes, auth cookies, logs and manifests remain private. Captures mask only code
 * glyphs; application reads/actions and state are real. Never targets other services.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
const repo = process.cwd(), [directory, phase, baselineRef] = process.argv.slice(2);
assert(["before", "after", "final", "continuation", "branding", "readback"].includes(phase));
const output = join(repo, "docs/design/rollout-1692/1823");
await mkdir(output, { recursive: true });
const read = async name => JSON.parse(await readFile(join(directory, name), "utf8"));
const runtime = await read("runtime-private.json"), fixture = await read("fixture-private.json"), services = await read("services.json");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
assert.equal(resolve(git("rev-parse", "--show-toplevel")), resolve(repo));
assert.equal(fixture.kind, "disposable");
assert.equal(services.label, "z8-performance-fixture-1450");
assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(new URL(runtime.origin).hostname, "localhost");
for (const name of services.containers) {
  assert.match(name, /^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);
  assert.equal(execFileSync("docker", ["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', name], { encoding: "utf8", windowsHide: true }).trim(), services.label);
}
const require = createRequire(join(repo, "package.json"));
const { Pool } = createRequire(join(repo, "apps/webapp/package.json"))("pg");
const pool = new Pool({ host: runtime.env.POSTGRES_HOST, port: Number(runtime.env.POSTGRES_PORT), database: runtime.env.POSTGRES_DB, user: runtime.env.POSTGRES_USER, password: runtime.env.POSTGRES_PASSWORD });
assert.equal((await pool.query("select current_database() as name")).rows[0].name, runtime.env.POSTGRES_DB);
for (const actor of Object.values(fixture.actors)) {
  const record = (await pool.query('select id from "user" where email=$1', [actor.email])).rows[0];
  assert.ok(record, "Synthetic actor exists");
  actor.userId = record.id;
}
let codes;
try { codes = await read("join-private.json"); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  codes = {};
  for (const [label, approval, target] of [["approved", false, "large-admin"], ["pending", true, "large-admin"], ["revoked", false, "large-admin"], ["member", false, "small-admin"]]) {
    const code = "R024-" + randomBytes(6).toString("hex").toUpperCase();
    const actor = fixture.actors[target];
    const inserted = await pool.query("insert into invite_code (organization_id, code, label, requires_approval, created_by) values ($1,$2,$3,$4,$5) returning id", [actor.organizationId, code, "R024 owned disposable " + label, approval, actor.userId]);
    codes[label] = { code, id: inserted.rows[0].id, organizationId: actor.organizationId };
  }
  await writeFile(join(directory, "join-private.json"), JSON.stringify(codes), { mode: 0o600 });
}
const sourcePaths = ["apps/webapp/src/components/join-organization-form.tsx", "apps/webapp/src/components/join-organization-form-body.tsx", "apps/webapp/src/app/[locale]/(auth)/join/[code]/page.tsx", "apps/webapp/src/lib/auth/use-auth-page-session.ts"];
const originals = new Map();
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", "utf8");
let browser, context;
const checks = [];
const check = (name, value, details) => { assert.ok(value, name); checks.push({ name, passed: true, ...details }); console.log("Checked: "+name); };
try {
  if (phase === "before") {
    assert.ok(baselineRef,"A verified Git baseline ref is required for a reusable before run");
    git("merge-base","--is-ancestor",baselineRef,"HEAD");
    for (const path of sourcePaths) {
      originals.set(path, await readFile(join(repo, path), "utf8"));
      const baseline = execFileSync("git", ["show", baselineRef + ":" + path], { cwd: repo, encoding: "utf8", windowsHide: true });
      await writeFile(join(repo, path), baseline, "utf8");
    }
  }
  const sources = [];
  for (const path of sourcePaths) sources.push({ path, sha256: createHash("sha256").update(await readFile(join(repo, path))).digest("hex") });
  const dirtySources = git("diff", "--name-only", "--", "apps/webapp/src");
  const dirtySourceHashes = await Promise.all(dirtySources.split(/\r?\n/).filter(Boolean).map(async path => ({path, sha256:createHash("sha256").update(await readFile(join(repo,path))).digest("hex")})));
  const source = { head: git("rev-parse", "HEAD"), overrideFrom: phase === "before" ? git("rev-parse",baselineRef) : null, dirtySources, dirtySourceHashes, sources };
  const session = execFileSync(process.env.npm_execpath, ["exec", "agent-browser", "session", "id", "--scope", "worktree", "--prefix", "z8-1823"], { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  const native = execFileSync(process.env.npm_execpath, ["exec", "agent-browser", "--session", session, "--restore", "get", "cdp-url"], { cwd: repo, encoding: "utf8", windowsHide: true });
  const endpoint = native.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+/)[0];
  browser = await require("puppeteer-core").connect({ browserWSEndpoint: endpoint });
  context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.bringToFront();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const waitText = text => page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
  const button = async text => {
    const element = await page.waitForSelector(`::-p-aria(${text}[role="button"])`);
    await element.click();
  };
  const auth = await read("dev-auth-private.json");
  async function actor(label) {
    await context.deleteCookie(...await context.cookies());
    await context.setCookie(...auth[label].cookies);
  }
  const goto = async (key, locale = "en") => {
    await page.goto(new URL(`/${locale}/join/${codes[key].code}`, runtime.origin).href, { waitUntil: "networkidle0", timeout: 90000 });
    await page.waitForFunction(() => !!document.querySelector("input[name=code]") && !document.body.innerText.includes("Validating code..."));
  };
  const capture = async (name, width, height) => {
    await page.setViewport({ width, height });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.addStyleTag({ content: 'input[name="code"] { -webkit-text-security: disc !important; }' });
    await page.screenshot({ path: join(output, `${phase}-${name}.png`), fullPage: true });
    const info = await page.evaluate(() => ({
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      fontPreference: localStorage.getItem("z8-font-size"), theme: localStorage.getItem("theme"),
      rootFont: getComputedStyle(document.documentElement).fontSize,
      bodyFont: getComputedStyle(document.body).fontSize,
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(document.querySelector("h1") ?? document.body).fontSize,
      inputFont: getComputedStyle(document.querySelector("input") ?? document.body).fontSize,
      headingCount: document.querySelectorAll("h1").length,
      focus: { tag: document.activeElement?.tagName, name: document.activeElement?.getAttribute("name"), outline: getComputedStyle(document.activeElement).outlineStyle, shadow: getComputedStyle(document.activeElement).boxShadow },
    }));
    check(name + " fits viewport", info.documentWidth <= width, { metrics: info });
    return info;
  };
  await goto("pending");
  await capture("desktop-light", 1600, 1000);
  await capture("phone-light", 390, 844);
  await button("Toggle theme");
  await page.waitForSelector('::-p-aria(Dark[role="menuitem"])').then(el => el.click());
  await button("Font size");
  await page.waitForSelector('::-p-aria(Large[role="menuitemradio"])').then(el => el.click());
  await page.reload({ waitUntil: "networkidle0" });
  await capture("phone-dark-large", 390, 844);
  await capture("wide-dark-large", 2400, 1200);
  const input = await page.$('input[name="code"]');
  await input.focus();
  await page.keyboard.press("Tab");
  await capture("keyboard", 390, 844);
  if (phase === "after") {
    check("one main heading", await page.$$eval("h1", list => list.length === 1));
    await button("Sign in to Join");
    await page.waitForFunction(() => location.pathname.endsWith("/sign-in"));
    const href = new URL(page.url());
    check("real sign-in continuation preserves locale/code", href.searchParams.get("callbackUrl") === "/en/join/" + codes.pending.code);
    await goto("pending", "de");
    const localizedLink = await page.$eval('a[href*="callbackUrl"]', el => el.getAttribute("href"));
    check("German sign-in callback", new URL(localizedLink, runtime.origin).searchParams.get("callbackUrl") === "/de/join/" + codes.pending.code);
    // Return to English for shared role and status assertions.
    await actor("small-restricted");
    await goto("pending");
    const pendingRequest = new Promise(resolveRequest => {
      const onRequest = request => {
        if (request.method() === "POST" && request.headers()["next-action"]) {
          page.off("request", onRequest);
          resolveRequest(request);
        } else request.continue();
      };
      page.setRequestInterception(true).then(() => page.on("request", onRequest));
    });
    await button("Join Organization");
    const held = await pendingRequest;
    await waitText("Joining...");
    await capture("pending-action", 390, 844);
    check("pending disables code and join", await page.$eval('input[name="code"]', el => el.disabled));
    await held.continue();
    page.removeAllListeners("request");
    await page.setRequestInterception(false);
    await waitText("Join Request Sent");
    await capture("request-sent", 390, 844);
    const pendingActor = fixture.actors["small-restricted"];
    const pendingRow = (await pool.query("select m.status, (select count(*)::int from employee e where e.user_id=m.user_id and e.organization_id=m.organization_id) employees from member m where m.user_id=$1 and m.organization_id=$2", [pendingActor.userId, codes.pending.organizationId])).rows[0];
    check("pending persisted without employee", pendingRow.status === "pending" && pendingRow.employees === 0);
    const forbidden = await page.evaluate(async id => (await fetch("/api/organizations/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: id }) })).status, codes.pending.organizationId);
    check("pending cannot activate target organization", forbidden === 403);
    const pendingContinue = await page.$('a[href="/en"]') ?? await page.$('a[href="/"]');
    check("pending continuation available", !!pendingContinue);
    await actor("small-employee");
    await goto("approved");
    await button("Join Organization");
    await waitText("Joined Successfully");
    await capture("approved", 1600, 1000);
    const approvedActor = fixture.actors["small-employee"];
    const approvedRow = (await pool.query("select m.status, (select count(*)::int from employee e where e.user_id=m.user_id and e.organization_id=m.organization_id) employees, (select count(*)::int from invite_code_usage u where u.member_id=m.id) uses from member m where m.user_id=$1 and m.organization_id=$2", [approvedActor.userId, codes.approved.organizationId])).rows[0];
    check("approved membership joined exactly once", approvedRow.status === "approved" && approvedRow.employees === 1 && approvedRow.uses === 1);
    await goto("approved");
    await button("Join Organization");
    await waitText("Joined Successfully");
    check("existing approved membership is idempotent", (await pool.query("select count(*)::int as n from invite_code_usage where user_id=$1 and invite_code_id=$2", [approvedActor.userId, codes.approved.id])).rows[0].n === 1);
    await actor("small-manager");
    await goto("revoked");
    await pool.query("update invite_code set status='archived' where id=$1 and organization_id=$2", [codes.revoked.id, codes.revoked.organizationId]);
    await button("Join Organization");
    await page.waitForFunction(() => !!document.querySelector('p[role="alert"]'));
    await capture("server-refusal", 390, 844);
    check("revoked code retains input", await page.$eval('input[name="code"]', (el, code) => el.value === code && !el.disabled, codes.revoked.code));
    check("refused join creates no membership", (await pool.query("select count(*)::int as n from member where user_id=$1 and organization_id=$2", [fixture.actors["small-manager"].userId, codes.revoked.organizationId])).rows[0].n === 0);
    await pool.query("update invite_code set status='active' where id=$1 and organization_id=$2", [codes.revoked.id, codes.revoked.organizationId]);
    await button("Join Organization");
    await waitText("Joined Successfully");
    check("real retry succeeds after authority restored", true);
    await actor("small-admin");
    await goto("member");
    await button("Join Organization");
    await waitText("Joined Successfully");
    check("existing admin membership remains admin", (await pool.query("select role from member where user_id=$1 and organization_id=$2", [fixture.actors["small-admin"].userId, codes.member.organizationId])).rows[0].role === "admin");
    // Server rechecks authentication after the page has resolved the code.
    await goto("member");
    await context.deleteCookie(...await context.cookies());
    await button("Join Organization");
    await page.waitForFunction(() => !!document.querySelector('p[role="alert"]'));
    await capture("session-refusal", 390, 844);
    check("late signed-out join safely refused", await page.$eval('input[name="code"]', el => !el.disabled));
  }
  if (phase === "continuation") {
    await button("Sign in to Join");
    await page.waitForSelector('input[name="email"]');
    await page.type('input[name="email"]', fixture.actors["small-restricted"].email);
    await page.type('input[name="password"]', fixture.actors["small-restricted"].password);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(el => el.innerText === "Login" && !el.disabled));
    await button("Login");
    await page.waitForFunction(() => location.pathname.includes("/init") || location.pathname.includes("/join/"));
    if (new URL(page.url()).pathname.includes("/init")) {
      await page.waitForFunction(() => location.pathname.includes("/join/") || [...document.querySelectorAll("button")].some(el => el.innerText.includes("Performance small")));
      if (new URL(page.url()).pathname.includes("/init")) {
        const choice = await page.waitForSelector('::-p-text(Performance small)');
        await choice.click();
      }
    }
    await page.waitForFunction(() => location.pathname.includes("/join/"));
    await waitText(fixture.actors["small-restricted"].email);
    check("actual sign-in and init return to invitation", new URL(page.url()).pathname === "/en/join/" + codes.pending.code);
    check("sign-in continuation did not approve pending membership", (await pool.query("select status from member where user_id=$1 and organization_id=$2", [fixture.actors["small-restricted"].userId,codes.pending.organizationId])).rows[0].status === "pending");
    await capture("returned-from-sign-in",390,844);
    for (const scope of ["organization", "account"]) {
      await actor("small-employee");
      const restored = await page.evaluate(async id => (await fetch("/api/organizations/switch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:id})})).status, fixture.actors["small-employee"].organizationId);
      check("restored synthetic scope before "+scope+" test",restored===200);
      await goto("member");
      await page.setRequestInterception(true);
      let release;
      const held = new Promise(resolveRequest => { release=resolveRequest; });
      const intercept = request => {
        if(request.method()==="POST" && request.headers()["next-action"]) {
          page.off("request",intercept);
          page.on("request",request=>request.continue());
          release(request);
        } else request.continue();
      };
      page.on("request",intercept);
      await button("Join Organization");
      const request = await held;
      await waitText("Joining...");
      if(scope==="organization") {
        const switched = await page.evaluate(async id => (await fetch("/api/organizations/switch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId:id})})).status,codes.approved.organizationId);
        check("real organization switch succeeds during held join",switched===200);
      } else await actor("small-admin");
      await page.bringToFront();
      // This automation browser keeps all pages visible. Simulate the browser's
      // hidden/visible notification pair; the session reads and switches are real.
      await page.evaluate(()=>{
        Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});
        window.dispatchEvent(new Event("visibilitychange"));
        delete document.visibilityState;
        window.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(()=>!document.querySelector('input[name="code"]').disabled);
      if(scope==="account") await waitText(fixture.actors["small-admin"].email);
      const actionId = request.headers()["next-action"];
      const response = page.waitForResponse(response=>response.request().method()==="POST" && response.request().headers()["next-action"]===actionId);
      await request.continue();
      await response;
      await page.waitForFunction(()=>document.querySelector("h1")?.innerText==="Join Organization");
      check(scope+" switch drops old join outcome", await page.$eval("h1",el=>el.innerText==="Join Organization"));
      await page.setRequestInterception(false);
      page.removeAllListeners("request");
      await capture("inflight-"+scope+"-switch",390,844);
    }
  }
  if(phase === "continuation" || phase === "readback") {
    const readback=[];
    for(const [label,kind] of [["small-restricted","pending"],["small-employee","approved"]]) {
      const result=await pool.query('select m.status,to_char(m.created_at,\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') as "membershipCreatedAtUtc",(select count(*)::int from employee e where e.organization_id=m.organization_id and e.user_id=m.user_id) as employees,(select count(*)::int from invite_code_usage u where u.member_id=m.id) as "codeUses" from member m where m.user_id=$1 and m.organization_id=$2',[fixture.actors[label].userId,codes[kind].organizationId]);
      readback.push({syntheticActor:label,target:"Performance large",...result.rows[0]});
    }
    await save("membership-readback.json",{source,readback});
  }
  if(phase === "branding") {
    assert.equal(runtime.env.PLATFORM_DOMAIN,"localhost");
    const org = (await pool.query("select slug from organization where id=$1",[codes.pending.organizationId])).rows[0];
    await pool.query("insert into organization_branding (organization_id,app_name,primary_color,updated_at) values ($1,$2,$3,now()) on conflict (organization_id) do update set app_name=excluded.app_name,primary_color=excluded.primary_color,updated_at=now()",[codes.pending.organizationId,"R024 Fixture Workspace","#2563eb"]);
    const brandedOrigin = "http://"+org.slug+".localhost:"+runtime.port;
    await page.goto(new URL("/en/join/"+codes.pending.code,brandedOrigin).href,{waitUntil:"networkidle0",timeout:60000});
    await waitText("R024 Fixture Workspace");
    await waitText("Performance large");
    check("real organization host resolves stored branding",await page.$eval("form",el=>el.innerText.includes("R024 Fixture Workspace")));
    const styles=await page.$eval('button[type="submit"]',el=>({color:getComputedStyle(el).backgroundColor,root:getComputedStyle(document.documentElement).fontSize}));
    check("stored primary color reaches real action",styles.color==="rgb(37, 99, 235)",{styles});
    await capture("branded-desktop",1600,1000);
    await capture("branded-phone",390,844);
  }
  await save(phase + "-runtime.json", { phase, source, syntheticFixture: "R024 owned disposable; same target organization and code in paired captures", codeMask: "Code glyphs masked only in PNG capture", checks, pageErrors: errors });
  await context.close();
  context = null;
  browser.disconnect();
} finally {
  if (context) await context.close();
  if (browser?.connected) browser.disconnect();
  for (const [path, value] of originals) await writeFile(join(repo, path), value, "utf8");
  await pool.end();
}
console.log(phase + ": " + checks.length + " runtime assertions passed.");
