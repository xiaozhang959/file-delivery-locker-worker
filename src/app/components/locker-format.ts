export const PICKUP_CODE_LENGTH = 6;

export function normalizePickupCode(value: string) {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, PICKUP_CODE_LENGTH);
}

export function formatBytes(value: number) {
	if (value < 1024) {
		return `${value} B`;
	}

	const units = ["KB", "MB", "GB"];
	let size = value / 1024;
	let index = 0;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}

	return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatCount(value: number) {
	return String(value);
}

export function formatTime(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(new Date(value));
}
