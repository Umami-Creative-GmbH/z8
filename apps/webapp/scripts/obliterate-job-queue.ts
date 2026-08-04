import { getJobQueue } from "@/lib/queue";
import { obliterateJobQueue } from "@/lib/queue/obliterate";

async function main(): Promise<void> {
	const confirmation = process.argv
		.slice(2)
		.find((argument) => argument.startsWith("--confirm="))
		?.slice("--confirm=".length);

	await obliterateJobQueue(getJobQueue(), confirmation);
	console.log("Job queue obliterated successfully.");
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
