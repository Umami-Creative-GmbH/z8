import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { chatInstallationQueries } from "./chat-installation-queries";
import { queryKeys } from "./keys";

it("invalidates member links and channel availability only for the affected organization", async () => {
	const client = new QueryClient();
	const keys = queryKeys.notifications;
	const affected = [keys.preferences("changed"), keys.chatLinks("member", "changed")];
	const unaffected = [
		keys.preferences("other"),
		keys.chatLinks("member", "other"),
		keys.chatLinks(),
		keys.preferences(),
	];
	for (const key of [...affected, ...unaffected]) client.setQueryData(key, {});
	await client.invalidateQueries(chatInstallationQueries("changed"));
	for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
	for (const key of unaffected) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});
