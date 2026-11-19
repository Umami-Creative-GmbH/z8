import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createViteServer, type Vite } from "vitest/node";

// Real File -> React hook -> Uppy/Tus -> HTTP. Only object storage/staging is
// modeled here; canonical admission and document creation have their PG suite.
const executablePath = process.env.Z8_TEST_CHROME_PATH;
describe.skipIf(!executablePath)("payslip upload transport", () => {
	let browser: Browser;
	let page: Page;
	let vite: Vite.ViteDevServer;
	let directory: string;
	let origin: string;
	const uploads = new Map<string, { length: number; offset: number }>();
	const objects = new Map<string, Buffer>();
	const staged: Array<{ batchId: string; tusFileKey: string }> = [];
	const stagedBytes: Buffer[] = [];
	const heads: Array<{ key: string; offset: number }> = [];
	const trace: unknown[] = [];
	let holdPatch = false;
	let heldResponse: ServerResponse | undefined;
	const callerId = resolve("src/test/payslip-upload-browser-caller.tsx").replaceAll("\\", "/");
	const caller = `
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import { usePayslipBatchUpload } from '@/components/personnel-file/use-payslip-batch-upload';
import { stageUpload } from '@/components/personnel-file/payslip-batch-upload-client';
import { getTusFileKeyFromUploadUrl } from '@/lib/upload/tus-url';
const onStaged = () => {};
// Model the released client's real upload/staging calls, preserving its default
// completed-URL cache. No localStorage internals or synthetic cache entries.
function PreviousIntake({ batchId }) {
  const [uppy, setUppy] = useState(null), [staged, setStaged] = useState(0);
  useEffect(() => {
    const client = new Uppy({ id: 'uppy', autoProceed: true }).use(Tus, {
      endpoint: '/api/tus', removeFingerprintOnSuccess: false,
    });
    client.on('upload-success', async (file, response) => {
      await stageUpload({ batchId, fileName: file.name, tusFileKey: getTusFileKeyFromUploadUrl(response.uploadURL) });
      setStaged(1);
      client.removeFile(file.id);
    });
    setUppy(client);
    return () => client.destroy();
  }, [batchId]);
  return <section>
    <input aria-label="PDF files" type="file" disabled={!uppy} onChange={event => {
      const file = event.currentTarget.files[0];
      uppy.addFile({ name: file.name, type: 'application/pdf', data: file, meta: { purpose: 'payslip-batch' } });
      event.currentTarget.value = '';
    }} />
    <output aria-label="Staged files">{staged}</output>
    <output aria-label="Failed files">0</output>
  </section>;
}
function Intake({ batchId }) {
  const upload = usePayslipBatchUpload({ batchId, onStaged });
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <section>
    <input aria-label="PDF files" type="file" disabled={!ready} accept="application/pdf" onChange={event => {
      upload.addFiles(Array.from(event.currentTarget.files));
      event.currentTarget.value = '';
    }} />
    <output aria-label="Staged files">{upload.progress.staged}</output>
    <output aria-label="Failed files">{upload.progress.failed.length}</output>
  </section>;
}
function Probe() {
  const [batch, setBatch] = useState(1);
  return <main>
    <button onClick={() => setBatch(value => value + 1)}>Next batch</button>
    <output aria-label="Current batch">{batch}</output>
    {batch === 1 && new URLSearchParams(location.search).has('previous')
      ? <PreviousIntake batchId="previous-batch" />
      : <Intake key={batch} batchId={'batch-' + batch} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Probe />);
`;
	const server = createServer(async (request, response) => {
		const path = new URL(request.url!, "http://localhost").pathname;
		if (!path.startsWith("/api/")) {
			if (path === "/") {
				response.setHeader("Content-Type", "text/html");
				response.end(
					'<div id="root"></div><script type="module" src="/upload-probe.tsx"></script>',
				);
			} else {
				vite.middlewares(request, response);
			}
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const bytes = Buffer.concat(chunks);
		trace.push({
			method: request.method,
			path,
			offset: request.headers["upload-offset"],
			bytes: bytes.length,
		});
		response.setHeader("Tus-Resumable", "1.0.0");
		if (request.method === "POST" && path === "/api/tus") {
			const key = `upload-${uploads.size + 1}`;
			uploads.set(key, { length: Number(request.headers["upload-length"]), offset: 0 });
			objects.set(key, Buffer.alloc(0));
			response.writeHead(201, { Location: `/api/tus/${key}` });
			response.end();
			return;
		}
		if (path.startsWith("/api/tus/")) {
			const key = path.slice("/api/tus/".length);
			const upload = uploads.get(key);
			if (!upload) {
				response.writeHead(404).end();
				return;
			}
			if (request.method === "HEAD") {
				heads.push({ key, offset: upload.offset });
				response
					.writeHead(200, {
						"Upload-Offset": String(upload.offset),
						"Upload-Length": String(upload.length),
					})
					.end();
				return;
			}
			if (request.method === "PATCH") {
				if (holdPatch && upload.offset > 0) {
					holdPatch = false;
					heldResponse = response;
					return;
				}
				objects.set(key, Buffer.concat([objects.get(key) ?? Buffer.alloc(0), bytes]));
				upload.offset += bytes.length;
				response.writeHead(204, { "Upload-Offset": String(upload.offset) }).end();
				return;
			}
		}
		if (request.method === "POST" && path === "/api/upload/personnel-file/payslip-batch") {
			const input = JSON.parse(bytes.toString());
			response.setHeader("Content-Type", "application/json");
			if (!objects.has(input.tusFileKey)) {
				response.writeHead(500).end(JSON.stringify({ error: "Processing failed" }));
				return;
			}
			// Temporary bytes are consumed, but completed TUS metadata remains.
			stagedBytes.push(Buffer.from(objects.get(input.tusFileKey)!));
			objects.delete(input.tusFileKey);
			staged.push(input);
			response.end(JSON.stringify({ success: true }));
			return;
		}
		response.writeHead(404).end();
	});

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "z8-payslip-browser-"));
		vite = await createViteServer({
			configFile: false,
			cacheDir: join(directory, "vite-cache"),
			root: process.cwd(),
			appType: "custom",
			server: { middlewareMode: true, hmr: false, watch: null },
			resolve: { alias: { "@": resolve("src") } },
			plugins: [
				{
					name: "payslip-test-caller",
					resolveId: (id) => (id === "/upload-probe.tsx" ? callerId : undefined),
					load: (id) => (id === callerId ? caller : undefined),
				},
			],
		});
		await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing upload test port");
		origin = `http://127.0.0.1:${address.port}`;
		browser = await puppeteer.launch({
			executablePath,
			headless: true,
			args: ["--disable-background-networking", "--disable-notifications"],
		});
	}, 30_000);

	beforeEach(async () => {
		await page?.close();
		uploads.clear();
		objects.clear();
		staged.length = 0;
		stagedBytes.length = 0;
		heads.length = 0;
		trace.length = 0;
		holdPatch = false;
		heldResponse = undefined;
		page = await browser.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		page.on("response", (response) => {
			if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
		});
		await page.goto(origin);
		await page.waitForSelector('input[type="file"]', { timeout: 3_000 }).catch((error) => {
			throw new Error(`${error.message}; browser errors: ${errors.join("; ")}`);
		});
	});

	afterAll(async () => {
		heldResponse?.destroy();
		await browser?.close();
		server.closeAllConnections();
		await new Promise<void>((yes) => server.close(() => yes()));
		await vite?.close();
		if (directory) {
			expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
			expect(basename(directory)).toMatch(/^z8-payslip-browser-/);
			await rm(directory, { recursive: true, force: true });
		}
	});

	async function choose(path: string) {
		const input = await page.waitForSelector('input[type="file"]:not(:disabled)');
		if (!input) throw new Error("Missing file input");
		await input.uploadFile(path);
	}
	async function settled() {
		await page.waitForFunction(
			() =>
				Number(document.querySelector('[aria-label="Staged files"]')?.textContent) +
					Number(document.querySelector('[aria-label="Failed files"]')?.textContent) >
				0,
		);
		return page.$eval('[aria-label="Staged files"]', (element) => Number(element.textContent));
	}

	it("uploads the same PDF again after an earlier batch consumed its temporary bytes", async () => {
		const file = join(directory, "300.pdf");
		const bytes = Buffer.from("%PDF-1.4\n% transport fixture\n%%EOF\n");
		await writeFile(file, bytes);
		await choose(file);
		expect(await settled()).toBe(1);
		await page.locator("button ::-p-text(Next batch)").click();
		await page.waitForFunction(
			() => document.querySelector('[aria-label="Current batch"]')?.textContent === "2",
		);
		await choose(file);
		expect(await settled()).toBe(1);
		expect(staged.map(({ batchId }) => batchId)).toEqual(["batch-1", "batch-2"]);
		expect(new Set(staged.map(({ tusFileKey }) => tusFileKey)).size).toBe(2);
		expect(stagedBytes).toEqual([bytes, bytes]);
	}, 15_000);

	it("still resumes unfinished bytes after a browser reload", async () => {
		const file = join(directory, "unfinished.pdf");
		const bytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(6 * 1024 * 1024)]);
		await writeFile(file, bytes);
		holdPatch = true;
		await choose(file);
		await expect.poll(() => heldResponse !== undefined).toBe(true);
		await page.reload();
		heldResponse?.destroy();
		await choose(file);
		expect(await settled()).toBe(1);
		expect(uploads.size).toBe(1);
		expect(heads, JSON.stringify(trace)).toEqual([{ key: "upload-1", offset: 5 * 1024 * 1024 }]);
		expect(stagedBytes).toEqual([bytes]);
	}, 15_000);

	it("ignores a consumed completed URL retained by the previous client", async () => {
		const file = join(directory, "previous.pdf");
		const bytes = Buffer.from("%PDF-1.4\n% previous client fixture\n%%EOF\n");
		await writeFile(file, bytes);
		await page.goto(`${origin}/?previous`);
		await choose(file);
		expect(await settled()).toBe(1);
		await page.locator("button ::-p-text(Next batch)").click();
		await page.waitForFunction(
			() => document.querySelector('[aria-label="Current batch"]')?.textContent === "2",
		);
		await choose(file);
		expect(await settled()).toBe(1);
		expect(staged.map(({ batchId }) => batchId)).toEqual(["previous-batch", "batch-2"]);
		expect(stagedBytes).toEqual([bytes, bytes]);
	}, 15_000);
});
