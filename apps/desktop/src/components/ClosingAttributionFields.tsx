import { attributionAvailability } from "../lib/attribution-availability";
import { useI18n } from "../lib/i18n";
import {
	offeredTasks,
	type useClosingAttribution,
} from "../hooks/useClosingAttribution";
import type { DesktopContext } from "../types";
export function ClosingAttributionFields({
	form,
	context,
	disabled,
}: {
	form: ReturnType<typeof useClosingAttribution>["form"];
	context: DesktopContext;
	disabled: boolean;
}) {
	const { t } = useI18n();
	const available = attributionAvailability(context);
	if (!available.project && !available.workCategory) return null;
	const fields = [
		{ name: "project", label: "Project", options: context.projects },
		{
			name: "workCategory",
			label: "Work category",
			options: context.categories,
		},
	] as const;
	return (
		<div className="attribution-fields">
			<p className="field-hint">{t("Applied when work ends")}</p>
			{fields
				.filter(({ name }) => available[name])
				.map(({ name, label, options }) => (
					<form.Field
						key={name}
						name={name}
						listeners={
							name === "project"
								? { onChange: () => form.setFieldValue("task", "") }
								: undefined
						}
					>
						{(field) => (
							<label className="form-field">
								{t(label)}
								<select
									name={field.name}
									value={field.state.value}
									disabled={disabled}
									onChange={(event) => field.handleChange(event.target.value)}
								>
									<option value="preserve">
										{t("Keep current assignment")}
									</option>
									<option value="clear">{t("No assignment")}</option>
									{options.map((option) => (
										<option key={option.id} value={option.id}>
											{option.name}
										</option>
									))}
								</select>
							</label>
						)}
					</form.Field>
				))}
			<form.Subscribe selector={(state) => state.values.project}>
				{(project) => {
					const { tasks, keepsProject } = offeredTasks(context, project);
					if (!tasks.length) return null;
					return (
						<form.Field name="task">
							{(field) => (
								<label className="form-field">
									{t("Task")}
									<select
										name={field.name}
										value={field.state.value}
										disabled={disabled}
										onChange={(event) => field.handleChange(event.target.value)}
									>
										<option value="">
											{t(keepsProject ? "Keep current task" : "No task")}
										</option>
										{keepsProject && (
											<option value="clear">{t("No task")}</option>
										)}
										{tasks.map((task) => (
											<option key={task.id} value={task.id}>
												{task.name}
											</option>
										))}
									</select>
								</label>
							)}
						</form.Field>
					);
				}}
			</form.Subscribe>
		</div>
	);
}
