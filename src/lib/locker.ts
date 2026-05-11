import { getCloudflareContext } from "@opennextjs/cloudflare";

export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_TEXT_SIZE = 256 * 1024;
export const ALLOWED_EXPIRY_HOURS = new Set([1, 24, 168]);
export const DELIVERY_KINDS = new Set(["file", "text"]);
export const MIN_DOWNLOADS = 1;
export const MAX_DOWNLOADS = 10;
export const SITE_AUTH_COOKIE = "file_delivery_locker_site_auth";
export const SITE_AUTH_MAX_AGE = 60 * 60 * 24 * 7;
export const ADMIN_AUTH_COOKIE = "file_delivery_locker_admin_auth";
export const ADMIN_AUTH_MAX_AGE = 60 * 60 * 8;

type SiteEnv = CloudflareEnv & {
	SITE_PASSWORD?: string;
	ADMIN_PASSWORD?: string;
	DEMO_MODE?: string;
};

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
	upload_ip: string | null;
	upload_user_agent: string | null;
	upload_browser: string | null;
	upload_os: string | null;
	upload_device: string | null;
	upload_country: string | null;
	upload_region: string | null;
	upload_city: string | null;
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

export type RequestSource = {
	ip: string | null;
	userAgent: string | null;
	browser: string | null;
	os: string | null;
	device: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
};

export type DeliveryEventAction = "upload" | "download" | "admin_revoke" | "admin_counts_update";

export type DeliveryEventInput = {
	deliveryId: string;
	action: DeliveryEventAction;
	actor: "user" | "admin" | "system";
	source: RequestSource;
	note?: string | null;
	previousMaxDownloads?: number | null;
	previousDownloadCount?: number | null;
	nextMaxDownloads?: number | null;
	nextDownloadCount?: number | null;
	createdAt?: number;
};

export async function getCloudflareBindings() {
	const { env, ctx } = await getCloudflareContext({ async: true });
	const siteEnv = env as SiteEnv;
	return {
		db: env.DB,
		bucket: env.FILE_BUCKET,
		sitePassword: normalizeSitePassword(siteEnv.SITE_PASSWORD),
		demoMode: isDemoModeEnabled(siteEnv.DEMO_MODE),
		ctx,
	};
}

export async function getSitePassword() {
	const { env } = await getCloudflareContext({ async: true });
	return normalizeSitePassword((env as SiteEnv).SITE_PASSWORD);
}

export async function getAdminPassword() {
	const { env } = await getCloudflareContext({ async: true });
	return normalizeSitePassword((env as SiteEnv).ADMIN_PASSWORD);
}

export async function getDemoMode() {
	const { env } = await getCloudflareContext({ async: true });
	return isDemoModeEnabled((env as SiteEnv).DEMO_MODE);
}

export function isDemoModeEnabled(value?: string | null) {
	const normalized = value?.trim().toLowerCase();
	return normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes" || normalized === "enabled";
}

export function isSiteLockEnabled(sitePassword: string | null) {
	return sitePassword !== null;
}

export async function isSiteAuthTokenValid(sitePassword: string | null, token?: string | null) {
	if (!isSiteLockEnabled(sitePassword)) {
		return true;
	}

	if (!token) {
		return false;
	}

	return token === (await createSiteAuthToken(sitePassword));
}

export async function isAdminAuthTokenValid(adminPassword: string | null, token?: string | null) {
	if (!adminPassword || !token) {
		return false;
	}

	return token === (await createAdminAuthToken(adminPassword));
}

export async function isSiteRequestAuthorized(request: Request) {
	if (await getDemoMode()) {
		return true;
	}

	const sitePassword = await getSitePassword();
	return isSiteAuthTokenValid(sitePassword, getCookieValue(request.headers.get("cookie"), SITE_AUTH_COOKIE));
}

export async function isAdminRequestAuthorized(request: Request) {
	if (await getDemoMode()) {
		return true;
	}

	const adminPassword = await getAdminPassword();
	return isAdminAuthTokenValid(adminPassword, getCookieValue(request.headers.get("cookie"), ADMIN_AUTH_COOKIE));
}

export async function requireSiteAuth(request: Request) {
	if (await isSiteRequestAuthorized(request)) {
		return null;
	}

	return json({ error: "Site password is required." }, 401);
}

export async function requireAdminAuth(request: Request) {
	if (await getDemoMode()) {
		return null;
	}

	const adminPassword = await getAdminPassword();
	if (!adminPassword) {
		return json({ error: "Admin password is not configured." }, 503);
	}

	if (await isAdminAuthTokenValid(adminPassword, getCookieValue(request.headers.get("cookie"), ADMIN_AUTH_COOKIE))) {
		return null;
	}

	return json({ error: "Admin password is required." }, 401);
}

export async function requireWritableMode() {
	if (await getDemoMode()) {
		return json({ error: "Demo mode is read-only." }, 403);
	}

	return null;
}

export async function createSiteAuthToken(sitePassword: string) {
	return hashText(`file-delivery-locker:${sitePassword}`);
}

export async function createAdminAuthToken(adminPassword: string) {
	return hashText(`file-delivery-locker:admin:${adminPassword}`);
}

export function serializeSiteAuthCookie(token: string, requestUrl: string) {
	const url = new URL(requestUrl);
	const parts = [
		`${SITE_AUTH_COOKIE}=${token}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${SITE_AUTH_MAX_AGE}`,
	];

	if (url.protocol === "https:") {
		parts.push("Secure");
	}

	return parts.join("; ");
}

export function serializeAdminAuthCookie(token: string, requestUrl: string) {
	const url = new URL(requestUrl);
	const parts = [
		`${ADMIN_AUTH_COOKIE}=${token}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${ADMIN_AUTH_MAX_AGE}`,
	];

	if (url.protocol === "https:") {
		parts.push("Secure");
	}

	return parts.join("; ");
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

export function getRequestSource(request: Request): RequestSource {
	const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
	const cloudflareContext = (request as Request & { cf?: { country?: string; region?: string; city?: string } }).cf;
	const parsed = parseUserAgent(userAgent);

	return {
		ip: getRequestIp(request),
		userAgent,
		browser: parsed.browser,
		os: parsed.os,
		device: parsed.device,
		country: normalizeSourceValue(cloudflareContext?.country),
		region: normalizeSourceValue(cloudflareContext?.region),
		city: normalizeSourceValue(cloudflareContext?.city),
	};
}

export async function recordDeliveryEvent(db: D1Database, input: DeliveryEventInput) {
	const source = input.source;
	await db
		.prepare(
			`INSERT INTO delivery_events (
				id,
				delivery_id,
				action,
				actor,
				ip,
				user_agent,
				browser,
				os,
				device,
				country,
				region,
				city,
				note,
				previous_max_downloads,
				previous_download_count,
				next_max_downloads,
				next_download_count,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			crypto.randomUUID(),
			input.deliveryId,
			input.action,
			input.actor,
			source.ip,
			source.userAgent,
			source.browser,
			source.os,
			source.device,
			source.country,
			source.region,
			source.city,
			input.note ?? null,
			input.previousMaxDownloads ?? null,
			input.previousDownloadCount ?? null,
			input.nextMaxDownloads ?? null,
			input.nextDownloadCount ?? null,
			input.createdAt ?? Date.now(),
		)
		.run();
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

export function createPickupCode() {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";

	do {
		code = Array.from({ length: 6 }, () => alphabet[randomIndex(alphabet.length)]).join("");
	} while (!/[A-Z]/.test(code) || !/[0-9]/.test(code));

	return code;
}

export async function hashCode(code: string) {
	return hashText(code.trim().toUpperCase());
}

async function hashText(value: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomIndex(max: number) {
	const bytes = new Uint8Array(1);
	const limit = Math.floor(256 / max) * max;
	let value = 0;

	do {
		crypto.getRandomValues(bytes);
		value = bytes[0];
	} while (value >= limit);

	return value % max;
}

function normalizeSitePassword(value?: string) {
	const password = value?.trim();
	return password ? password : null;
}

function getCookieValue(header: string | null, name: string) {
	if (!header) {
		return null;
	}

	for (const cookie of header.split(";")) {
		const [rawName, ...rawValue] = cookie.trim().split("=");
		if (rawName === name) {
			return rawValue.join("=");
		}
	}

	return null;
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

function getRequestIp(request: Request) {
	const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
	if (cloudflareIp) {
		return cloudflareIp.slice(0, 120);
	}

	const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwardedFor ? forwardedFor.slice(0, 120) : null;
}

function parseUserAgent(userAgent: string | null) {
	if (!userAgent) {
		return { browser: null, os: null, device: null };
	}

	const browser = parseBrowser(userAgent);
	const os = parseOs(userAgent);
	const device = parseDevice(userAgent);

	return { browser, os, device };
}

function parseBrowser(userAgent: string) {
	if (/Edg\//.test(userAgent)) {
		return "Edge";
	}

	if (/OPR\//.test(userAgent)) {
		return "Opera";
	}

	if (/SamsungBrowser\//.test(userAgent)) {
		return "Samsung Internet";
	}

	if (/Firefox\//.test(userAgent)) {
		return "Firefox";
	}

	if (/CriOS\//.test(userAgent)) {
		return "Chrome iOS";
	}

	if (/Chrome\//.test(userAgent)) {
		return "Chrome";
	}

	if (/Safari\//.test(userAgent)) {
		return "Safari";
	}

	return "Unknown";
}

function parseOs(userAgent: string) {
	if (/Windows NT/.test(userAgent)) {
		return "Windows";
	}

	if (/(iPhone|iPad|iPod)/.test(userAgent)) {
		return "iOS";
	}

	if (/Android/.test(userAgent)) {
		return "Android";
	}

	if (/Mac OS X/.test(userAgent)) {
		return "macOS";
	}

	if (/Linux/.test(userAgent)) {
		return "Linux";
	}

	return "Unknown";
}

function parseDevice(userAgent: string) {
	if (/(bot|crawler|spider|crawling)/i.test(userAgent)) {
		return "bot";
	}

	if (/(iPad|Tablet)/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) {
		return "tablet";
	}

	if (/(Mobile|iPhone|iPod|Android)/i.test(userAgent)) {
		return "mobile";
	}

	return "desktop";
}

function normalizeSourceValue(value?: string) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, 120) : null;
}
