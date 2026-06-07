"use client";

import type * as React from "react";

type AspectRatioProps = React.ComponentProps<"div"> & {
	ratio?: number;
};

function AspectRatio({ ratio = 1, style, ...props }: AspectRatioProps) {
	return (
		<div
			data-radix-aspect-ratio-wrapper=""
			style={{
				position: "relative",
				width: "100%",
				paddingBottom: `${100 / ratio}%`,
			}}
		>
			<div
				data-slot="aspect-ratio"
				style={{
					...style,
					position: "absolute",
					top: 0,
					right: 0,
					bottom: 0,
					left: 0,
				}}
				{...props}
			/>
		</div>
	);
}

export { AspectRatio };
