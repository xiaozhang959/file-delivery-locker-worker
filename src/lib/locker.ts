import { getCloudflareContext } from "@opennextjs/cloudflare";

export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_TEXT_SIZE = 256 * 1024;
export const ALLOWED_EXPIRY_HOURS = new Set([1, 24, 168]);
export const DELIVERY_KINDS = new Set(["file", "text"]);
export const MIN_DOWNLOADS = 1;
export const MAX_DOWNLOADS = 10;

export type DeliveryKind = "file" | "text";

export type DeliveryRow = {
	id: string;
	object_key: string;
	file_name: string;
	content_type: string;
	delivery_kind: DeliveryKind;
	size: number;
	pickup_code_hash: string;
	manage_code_hash: string;
	max_downloads: number;
	download_count: number;
	expires_at: number;
	created_at: number;
	deleted_at: number | null;
	deleted_reason: string | null;
};

export type DeliveryPublic = {
	id: string;
	fileName: string;
	contentType: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	downloadCount: number;
	remainingDownloads: number;
	expiresAt: string;
	createdAt: string;
	status: "available" | "expired" | "deleted" | "depleted";
};

export async function getCloudflareBindings() {
	const { env, ctx } = await getCloudflareContext({ async: true });
	return {
		db: env.DB,
		bucket: env.FILE_BUCKET,
		ctx,
	};
}

export function json(data: unknown, init?: ResponseInit | number) {
	const responseInit = typeof init === "number" ? { status: init } : init;

	return Response.json(data, {
		...responseInit,
		headers: {
			"cache-control": "no-store",
			...(responseInit?.headers ?? {}),
		},
	});
}

export function parseContentLength(request: Request) {
	const raw = request.headers.get("content-length");
	if (!raw) {
		return null;
	}

	const size = Number(raw);
	if (!Number.isSafeInteger(size) || size < 1) {
		return null;
	}

	return size;
}

export function parseDeliveryKind(request: Request): DeliveryKind | null {
	const value = request.headers.get("x-delivery-kind")?.trim() || "file";
	if (!DELIVERY_KINDS.has(value)) {
		return null;
	}

	return value as DeliveryKind;
}

export function parseExpiryHours(request: Request) {
	const value = Number(request.headers.get("x-expires-in-hours") ?? "24");
	if (!ALLOWED_EXPIRY_HOURS.has(value)) {
		return null;
	}

	return value;
}

export function parseMaxDownloads(request: Request) {
	const value = Number(request.headers.get("x-max-downloads") ?? "1");
	if (!Number.isInteger(value) || value < MIN_DOWNLOADS || value > MAX_DOWNLOADS) {
		return null;
	}

	return value;
}

export function getSafeFileName(request: Request) {
	const rawFileName = request.headers.get("x-file-name")?.trim();
	const fileName = rawFileName ? decodeHeaderValue(rawFileName) : null;
	if (!fileName) {
		return null;
	}

	return fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180);
}

function decodeHeaderValue(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function getContentType(request: Request) {
	const contentType = request.headers.get("x-content-type")?.trim() || request.headers.get("content-type")?.trim();
	return contentType?.slice(0, 120) || "application/octet-stream";
}

export function createCode(byteLength: number) {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function hashCode(code: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code.trim().toUpperCase()));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeDelivery(row: DeliveryRow, now = Date.now()): DeliveryPublic {
	const remainingDownloads = Math.max(0, row.max_downloads - row.download_count);
	let status: DeliveryPublic["status"] = "available";

	if (row.deleted_at !== null) {
		status = "deleted";
	} else if (row.expires_at <= now) {
		status = "expired";
	} else if (remainingDownloads < 1) {
		status = "depleted";
	}

	return {
		id: row.id,
		fileName: row.file_name,
		contentType: row.content_type,
		kind: row.delivery_kind,
		size: row.size,
		maxDownloads: row.max_downloads,
		downloadCount: row.download_count,
		remainingDownloads,
		expiresAt: new Date(row.expires_at).toISOString(),
		createdAt: new Date(row.created_at).toISOString(),
		status,
	};
}

export function isUnavailable(row: DeliveryRow, now = Date.now()) {
	if (row.deleted_at !== null) {
		return "deleted";
	}

	if (row.expires_at <= now) {
		return "expired";
	}

	if (row.download_count >= row.max_downloads) {
		return "depleted";
	}

	return null;
}

export function contentDisposition(fileName: string) {
	const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
