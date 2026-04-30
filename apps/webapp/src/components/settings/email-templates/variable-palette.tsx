import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmailTemplateVariableDefinition } from "@/lib/email/template-registry";

interface VariablePaletteProps {
	variables: EmailTemplateVariableDefinition[];
	onInsert: (name: string) => void;
}

export function VariablePalette({ variables, onInsert }: VariablePaletteProps) {
	return (
		<section
			className="rounded-xl border bg-muted/25 p-4"
			aria-labelledby="email-template-variables"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 id="email-template-variables" className="font-semibold text-sm">
						Allowed variables
					</h2>
					<p className="text-muted-foreground text-xs leading-5">
						Insert only approved placeholders. Values are replaced when the email is sent.
					</p>
				</div>
				<Badge variant="outline">Fallback safe</Badge>
			</div>

			<div className="mt-4 grid gap-2" data-testid="email-template-variable-list">
				{variables.map((variable) => (
					<Button
						key={variable.name}
						type="button"
						variant="outline"
						className="h-auto min-h-11 w-full min-w-0 justify-start whitespace-normal px-3 py-2 text-left"
						onClick={() => onInsert(variable.name)}
						aria-label={`Insert ${variable.label}`}
					>
						<span className="min-w-0 max-w-full">
							<span className="block break-all font-mono text-xs">
								{"{{"}
								{variable.name}
								{"}}"}
							</span>
							<span className="block break-all text-muted-foreground text-xs">
								{variable.example}
							</span>
						</span>
					</Button>
				))}
			</div>
		</section>
	);
}
