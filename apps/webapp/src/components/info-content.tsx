import { Streamdown } from "streamdown";

type InfoContentProps = {
	content: string;
};

export function InfoContent({ content }: InfoContentProps) {
	return (
		<div className="flex-1 overflow-y-auto">
			<div className="prose prose-slate dark:prose-invert max-w-none">
				<Streamdown>{content}</Streamdown>
			</div>
		</div>
	);
}
