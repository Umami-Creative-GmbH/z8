import { describe, expect, it } from "vitest";
import { taskIdAfter, taskIntentFollowingProject } from "./task-attribution";

const project = "project-a";
const otherProject = "project-b";

describe("taskIntentFollowingProject", () => {
	it("keeps the task while the write keeps the project", () => {
		const intent = taskIntentFollowingProject({
			task: undefined,
			projectId: project,
			currentProjectId: project,
		});
		expect(taskIdAfter(intent, "task-1")).toBe("task-1");
	});

	it("clears the task when the project changes or is cleared without a new task", () => {
		for (const projectId of [otherProject, null]) {
			for (const task of [undefined, { kind: "preserve" as const }]) {
				const intent = taskIntentFollowingProject({ task, projectId, currentProjectId: project });
				expect(taskIdAfter(intent, "task-1")).toBeNull();
			}
		}
	});

	it("applies an explicit task or clearing whatever the project does", () => {
		expect(
			taskIdAfter(
				taskIntentFollowingProject({
					task: { kind: "replace", id: "task-2" },
					projectId: otherProject,
					currentProjectId: project,
				}),
				"task-1",
			),
		).toBe("task-2");
		expect(
			taskIdAfter(
				taskIntentFollowingProject({
					task: { kind: "clear" },
					projectId: project,
					currentProjectId: project,
				}),
				"task-1",
			),
		).toBeNull();
	});
});
