import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Temporal } from "temporal-polyfill";
const endpoint = "http://127.0.0.1:9231";
const employeeId = "7d1f3f0e-8a4c-4a7e-9f39-0b8f1a2c3d4e";
const context = {
	userId: "native-qa-user",
	organizationId: "native-qa-org",
	employeeId,
	server: endpoint,
};
const stateFile = new URL("../.native-qa/server-state.json", import.meta.url);
const previous = existsSync(stateFile)
	? JSON.parse(readFileSync(stateFile, "utf8"))
	: {};
const receipts = new Map(previous.receipts ?? []);
let liveWork = previous.liveWork ?? null,
	completedMinutes = previous.completedMinutes ?? 0,
	offline = false,
	dropReply = false;
const persist = () =>
	writeFileSync(
		stateFile,
		JSON.stringify({
			liveWork,
			completedMinutes,
			receipts: [...receipts.entries()],
		}),
	);
const now = () => Temporal.Now.instant().toString();
const status = () => ({
	hasEmployee: true,
	employeeId,
	isClockedIn: !!liveWork,
	activeWorkPeriod: liveWork && {
		id: liveWork.id,
		startTime: liveWork.startTime,
	},
});
const server = createServer(async (request, response) => {
	const url = new URL(request.url, endpoint);
	const answer = (body, code = 200) => {
		response.writeHead(code, { "Content-Type": "application/json" });
		response.end(JSON.stringify(body));
	};
	if (url.pathname === "/__qa/state")
		return answer({ offline, liveWork, receipts: [...receipts.values()] });
	if (url.pathname === "/__qa/offline") {
		offline = url.searchParams.get("value") === "true";
		return answer({ offline });
	}
	if (url.pathname === "/__qa/drop-reply") {
		dropReply = true;
		return answer({ dropReply });
	}
	if (offline) {
		request.socket.destroy();
		return;
	}
	if (request.headers.authorization !== "Bearer native-qa-only-token")
		return answer({ error: "Unauthorized" }, 401);
	if (url.pathname === "/api/desktop/organizations")
		return answer({
			userId: context.userId,
			activeOrganizationId: context.organizationId,
			organizations: [
				{
					id: context.organizationId,
					name: "Native QA workspace",
					slug: "native-qa",
					logo: null,
					memberRole: "member",
					hasEmployeeRecord: true,
				},
			],
		});
	if (url.pathname === "/api/time-entries/status") return answer(status());
	if (url.pathname === "/api/time-entries/commands" && request.method === "GET")
		return answer({
			commandVersions: [2],
			kinds: ["clock_in", "clock_out", "break"],
			submit: "available",
			lookup: "available",
			context,
			admission: {
				immediate: { pastSeconds: 300, futureSeconds: 300 },
				delayed: { pastSeconds: 604800, futureSeconds: 300 },
			},
		});
	if (url.pathname === "/api/desktop/context") {
		const date = Temporal.Now.instant()
			.toZonedDateTimeISO("Europe/Berlin")
			.toPlainDate()
			.toString();
		return answer({
			...context,
			timezone: "Europe/Berlin",
			locale: "de",
			fetchedAt: now(),
			dayTotalBasis: {
				timezone: "Europe/Berlin",
				completedMinutesByDate: { [date]: completedMinutes },
				liveWork: liveWork ? [{ startedAt: liveWork.startTime }] : [],
			},
			projects: [
				{ id: "d7800000-0000-4000-8000-000000000002", name: "Client project" },
			],
			categories: [],
			liveWork,
		});
	}
	if (
		url.pathname === "/api/time-entries/commands" &&
		request.method === "POST"
	) {
		let body = "";
		for await (const chunk of request) body += chunk;
		const command = JSON.parse(body);
		let receipt = receipts.get(command.operationId);
		if (!receipt) {
			if (command.kind === "clock_in")
				liveWork = {
					id: command.operationId,
					startTime: command.occurredAt,
					projectId: null,
					workCategoryId: null,
					workLocationType: command.workLocationType,
				};
			else if (command.kind === "clock_out") {
				completedMinutes += Math.max(
					0,
					Math.round(
						(Temporal.Instant.from(command.occurredAt).epochMilliseconds -
							Temporal.Instant.from(liveWork.startTime).epochMilliseconds) /
							60000,
					),
				);
				liveWork = null;
			}
			receipt = {
				outcome: "executed",
				operationId: command.operationId,
				receipt: {
					kind:
						command.kind === "clock_in" ? "start_live_work" : "close_live_work",
					result: { workPeriodId: command.operationId },
				},
				originalCommand: command,
			};
			receipts.set(command.operationId, receipt);
			persist();
		}
		if (dropReply) {
			dropReply = false;
			request.socket.destroy();
			return;
		}
		return answer(receipt, 201);
	}
	if (url.pathname.startsWith("/api/time-entries/commands/")) {
		const id = url.pathname.split("/").at(-1);
		const saved = receipts.get(id);
		return answer(
			saved
				? { ...saved, outcome: "committed" }
				: { outcome: "not_committed", operationId: id },
		);
	}
	answer({ error: "Unknown QA route" }, 404);
});
server.listen(9231, "127.0.0.1", () =>
	console.log("Isolated native QA server listening on loopback 9231"),
);
