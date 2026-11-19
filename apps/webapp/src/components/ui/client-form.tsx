"use client";

import type { ComponentProps } from "react";

type ClientFormProps = Omit<ComponentProps<"form">, "onSubmit"> & {
	onSubmit: () => void;
	stopPropagation?: boolean;
};

export function ClientForm({ onSubmit, stopPropagation, ...props }: ClientFormProps) {
	return (
		// react-doctor-disable-next-line react-doctor/no-prevent-default -- TanStack validates and submits these forms in the client, including submissions from associated dialog footer buttons.
		<form
			{...props}
			onSubmit={(event) => {
				event.preventDefault();
				if (stopPropagation) event.stopPropagation();
				onSubmit();
			}}
		/>
	);
}
