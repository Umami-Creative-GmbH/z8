/** Saves a file an action returned as base64 through the browser's download. */
export function downloadBase64File(file: {
	filename: string;
	contentType: string;
	base64: string;
}): void {
	const binary = atob(file.base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
	const link = document.createElement("a");
	link.href = url;
	link.download = file.filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
