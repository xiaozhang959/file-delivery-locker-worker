import { getCloudflareContext } from "@opennextjs/cloudflare";
import Cap from "@cap.js/server";

export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_TEXT_SIZE = 256 * 1024;
export const PICKUP_CODE_LENGTH = 6;
export const ALLOWED_EXPIRY_HOURS = new Set([1, 24, 168]);
export const DELIVERY_KINDS = new Set(["file", "text"]);
export const UNLIMITED_EXPIRY = 0;
export const UNLIMITED_DOWNLOADS = 0;
export const MIN_DOWNLOADS = 1;
export const SITE_AUTH_COOKIE = "file_delivery_locker_site_auth";
export const SITE_CSRF_COOKIE = "file_delivery_locker_site_csrf";
export const SITE_AUTH_MAX_AGE = 60 * 60 * 24 * 7;
export const ADMIN_AUTH_COOKIE = "file_delivery_locker_admin_auth";
export const ADMIN_CSRF_COOKIE = "file_delivery_locker_admin_csrf";
export const ADMIN_AUTH_MAX_AGE = 60 * 60 * 8;
export const CAP_CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;
export const PICKUP_ACCESS_MAX_AGE_MS = 5 * 60 * 1000;
export const PICKUP_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const PICKUP_FAILURE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_FAILURE_RETENTION_MS = 24 * 60 * 60 * 1000;
const AUTH_LOCK_THRESHOLD = 5;
const AUTH_LOCK_BASE_MS = 60 * 1000;
const AUTH_LOCK_MAX_MS = 15 * 60 * 1000;
const CAP_CHALLENGE_SIZE = 32;

type SiteEnv = {
	DB: LockerDb;
	FILE_BUCKET: LockerBucket;
	SITE_PASSWORD?: string;
	ADMIN_PASSWORD?: string;
	PICKUP_CODE_PEPPER?: string;
	DEMO_MODE?: string;
};

type LockerD1RunResult = {
	meta: {
		changes?: number | null;
	};
};

type LockerD1AllResult<T> = {
	results?: T[];
};

type LockerD1Statement = {
	bind(...values: unknown[]): LockerD1Statement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<LockerD1AllResult<T>>;
	run(): Promise<LockerD1RunResult>;
};

export type LockerDb = {
	prepare(query: string): LockerD1Statement;
};

type TableColumnRow = {
	name: string;
};

type PickupPowFailureRow = {
	failure_count: number;
	window_started_at: number;
};

type PickupPowDifficulty = {
	subjectHash: string;
	failureCount: number;
	challengeCount: number;
	challengeSize: number;
	challengeDifficulty: number;
};

type AuthKind = "site" | "admin";

type AuthLoginFailureRow = {
	failure_count: number;
	window_started_at: number;
	locked_until: number | null;
};

export type AuthSession = {
	token: string;
	csrfToken: string;
	expiresAt: string;
};

export type AuthSessionValidation = {
	valid: boolean;
	csrfToken: string | null;
};

export type AuthLockStatus = {
	locked: boolean;
	retryAfterSeconds: number;
};

type LockerR2Object = {
	body: ReadableStream<Uint8Array>;
	size: number;
	httpMetadata?: {
		contentType?: string;
	};
	httpEtag: string;
	text(): Promise<string>;
};

type LockerR2PutOptions = {
	httpMetadata?: {
		contentDisposition?: string;
		contentType?: string;
	};
	customMetadata?: Record<string, string>;
};

export type LockerBucket = {
	get(key: string): Promise<LockerR2Object | null>;
	put(key: string, value: ReadableStream | ArrayBuffer, options?: LockerR2PutOptions): Promise<unknown>;
	delete(key: string): Promise<void>;
};

const fileDeliveryColumns: Record<string, string> = {
	delivery_kind: "TEXT NOT NULL DEFAULT 'file'",
	storage_key: "TEXT",
	content_hash: "TEXT",
	upload_ip: "TEXT",
	upload_user_agent: "TEXT",
	upload_browser: "TEXT",
	upload_os: "TEXT",
	upload_device: "TEXT",
	upload_country: "TEXT",
	upload_region: "TEXT",
	upload_city: "TEXT",
};

let schemaInitializationPromise: Promise<void> | null = null;

const cap = new Cap({
	noFSState: true,
	disableAutoCleanup: true,
	storage: {
		challenges: {
			store: async (token, data) => {
				const db = await getCapStorageDb();
				await db
					.prepare(
						`INSERT OR REPLACE INTO cap_challenges (
							token,
							challenge_count,
							challenge_size,
							challenge_difficulty,
							expires_at,
							created_at
						) VALUES (?, ?, ?, ?, ?, ?)`,
					)
					.bind(token, data.challenge.c, data.challenge.s, data.challenge.d, data.expires, Date.now())
					.run();
			},
			read: async (token) => {
				const db = await getCapStorageDb();
				const row = await db
					.prepare(
						`SELECT
							challenge_count,
							challenge_size,
							challenge_difficulty,
							expires_at
						FROM cap_challenges
						WHERE token = ?`,
					)
					.bind(token)
					.first<{
						challenge_count: number;
						challenge_size: number;
						challenge_difficulty: number;
						expires_at: number;
					}>();

				if (!row) {
					return null;
				}

				return {
					challenge: {
						c: Number(row.challenge_count),
						s: Number(row.challenge_size),
						d: Number(row.challenge_difficulty),
					},
					expires: Number(row.expires_at),
				};
			},
			delete: async (token) => {
				const db = await getCapStorageDb();
				await db.prepare("DELETE FROM cap_challenges WHERE token = ?").bind(token).run();
			},
			deleteExpired: async () => {
				const db = await getCapStorageDb();
				await deleteExpiredCapArtifacts(db, Date.now());
			},
		},
		tokens: {
			store: async (tokenKey, expires) => {
				const db = await getCapStorageDb();
				await db
					.prepare("INSERT OR REPLACE INTO cap_tokens (token_key, expires_at, created_at) VALUES (?, ?, ?)")
					.bind(tokenKey, expires, Date.now())
					.run();
			},
			get: async (tokenKey) => {
				const db = await getCapStorageDb();
				const row = await db
					.prepare("SELECT expires_at FROM cap_tokens WHERE token_key = ?")
					.bind(tokenKey)
					.first<{ expires_at: number }>();
				return row ? Number(row.expires_at) : null;
			},
			delete: async (tokenKey) => {
				const db = await getCapStorageDb();
				await db.prepare("DELETE FROM cap_tokens WHERE token_key = ?").bind(tokenKey).run();
			},
			deleteExpired: async () => {
				const db = await getCapStorageDb();
				await deleteExpiredCapArtifacts(db, Date.now());
			},
		},
	},
});

export type DeliveryKind = "file" | "text";

export type DeliveryRow = {
	id: string;
	object_key: string;
	storage_key: string;
	file_name: string;
	content_type: string;
	delivery_kind: DeliveryKind;
	size: number;
	content_hash: string | null;
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
	remainingDownloads: number | null;
	expiresAt: string | null;
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
	if (siteEnv.DB) {
		await ensureDatabaseSchema(siteEnv.DB);
	}

	return {
		db: siteEnv.DB,
		bucket: siteEnv.FILE_BUCKET,
		sitePassword: normalizeSitePassword(siteEnv.SITE_PASSWORD),
		demoMode: isDemoModeEnabled(siteEnv.DEMO_MODE),
		ctx,
	};
}

export async function ensureDatabaseSchema(db: LockerDb) {
	schemaInitializationPromise ??= initializeDatabaseSchema(db).catch((error) => {
		schemaInitializationPromise = null;
		throw error;
	});

	return schemaInitializationPromise;
}

async function initializeDatabaseSchema(db: LockerDb) {
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS file_deliveries (
				id TEXT PRIMARY KEY,
				object_key TEXT NOT NULL UNIQUE,
				storage_key TEXT,
				file_name TEXT NOT NULL,
				content_type TEXT NOT NULL,
				size INTEGER NOT NULL,
				content_hash TEXT,
				pickup_code_hash TEXT NOT NULL UNIQUE,
				manage_code_hash TEXT NOT NULL UNIQUE,
				max_downloads INTEGER NOT NULL,
				download_count INTEGER NOT NULL DEFAULT 0,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				deleted_at INTEGER,
				deleted_reason TEXT,
				delivery_kind TEXT NOT NULL DEFAULT 'file',
				upload_ip TEXT,
				upload_user_agent TEXT,
				upload_browser TEXT,
				upload_os TEXT,
				upload_device TEXT,
				upload_country TEXT,
				upload_region TEXT,
				upload_city TEXT
			)`,
		)
		.run();

	await ensureFileDeliveryColumns(db);
	await db.prepare("UPDATE file_deliveries SET storage_key = object_key WHERE storage_key IS NULL OR storage_key = ''").run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS delivery_events (
				id TEXT PRIMARY KEY,
				delivery_id TEXT NOT NULL,
				action TEXT NOT NULL,
				actor TEXT NOT NULL,
				ip TEXT,
				user_agent TEXT,
				browser TEXT,
				os TEXT,
				device TEXT,
				country TEXT,
				region TEXT,
				city TEXT,
				note TEXT,
				previous_max_downloads INTEGER,
				previous_download_count INTEGER,
				next_max_downloads INTEGER,
				next_download_count INTEGER,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (delivery_id) REFERENCES file_deliveries (id)
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS cap_challenges (
				token TEXT PRIMARY KEY,
				challenge_count INTEGER NOT NULL,
				challenge_size INTEGER NOT NULL,
				challenge_difficulty INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS cap_tokens (
				token_key TEXT PRIMARY KEY,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS pickup_pow_failures (
				subject_hash TEXT PRIMARY KEY,
				failure_count INTEGER NOT NULL,
				window_started_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS pickup_access_tokens (
				token_hash TEXT PRIMARY KEY,
				pickup_code_hash TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS auth_sessions (
				token_hash TEXT PRIMARY KEY,
				auth_kind TEXT NOT NULL,
				password_hash TEXT NOT NULL,
				csrf_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				ip TEXT,
				user_agent TEXT
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS auth_login_failures (
				subject_hash TEXT PRIMARY KEY,
				auth_kind TEXT NOT NULL,
				failure_count INTEGER NOT NULL,
				window_started_at INTEGER NOT NULL,
				locked_until INTEGER,
				updated_at INTEGER NOT NULL
			)`,
		)
		.run();

	await createDatabaseIndexes(db);
}

async function ensureFileDeliveryColumns(db: LockerDb) {
	const columns = await db.prepare("PRAGMA table_info(file_deliveries)").all<TableColumnRow>();
	const existingColumns = new Set((columns.results ?? []).map((column) => column.name));

	for (const [name, definition] of Object.entries(fileDeliveryColumns)) {
		if (!existingColumns.has(name)) {
			await addColumnIfMissing(db, "file_deliveries", name, definition);
		}
	}
}

async function addColumnIfMissing(db: LockerDb, table: string, name: string, definition: string) {
	try {
		await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (!message.toLowerCase().includes("duplicate column")) {
			throw error;
		}
	}
}

async function createDatabaseIndexes(db: LockerDb) {
	const statements = [
		"CREATE INDEX IF NOT EXISTS idx_file_deliveries_pickup_code_hash ON file_deliveries (pickup_code_hash)",
		"CREATE INDEX IF NOT EXISTS idx_file_deliveries_manage_code_hash ON file_deliveries (manage_code_hash)",
		"CREATE INDEX IF NOT EXISTS idx_file_deliveries_expires_at ON file_deliveries (expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_file_deliveries_content_hash ON file_deliveries (content_hash, size)",
		"CREATE INDEX IF NOT EXISTS idx_file_deliveries_storage_key ON file_deliveries (storage_key)",
		"CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id ON delivery_events (delivery_id, created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_delivery_events_created_at ON delivery_events (created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_delivery_events_action ON delivery_events (action)",
		"CREATE INDEX IF NOT EXISTS idx_cap_challenges_expires_at ON cap_challenges (expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_cap_tokens_expires_at ON cap_tokens (expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_pickup_pow_failures_updated_at ON pickup_pow_failures (updated_at)",
		"CREATE INDEX IF NOT EXISTS idx_pickup_access_tokens_pickup_code_hash ON pickup_access_tokens (pickup_code_hash)",
		"CREATE INDEX IF NOT EXISTS idx_pickup_access_tokens_expires_at ON pickup_access_tokens (expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_auth_sessions_auth_kind ON auth_sessions (auth_kind, expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_auth_login_failures_auth_kind ON auth_login_failures (auth_kind, updated_at)",
		"CREATE INDEX IF NOT EXISTS idx_auth_login_failures_updated_at ON auth_login_failures (updated_at)",
	];

	for (const statement of statements) {
		await db.prepare(statement).run();
	}
}

async function getCapStorageDb() {
	const { env } = await getCloudflareContext({ async: true });
	const db = (env as SiteEnv).DB;
	if (!db) {
		throw new Error("Cloudflare DB binding is not available.");
	}

	await ensureDatabaseSchema(db);
	return db;
}

export async function getSitePassword() {
	const { env } = await getCloudflareContext({ async: true });
	return normalizeSitePassword((env as SiteEnv).SITE_PASSWORD);
}

export async function getAdminPassword() {
	const { env } = await getCloudflareContext({ async: true });
	return normalizeSitePassword((env as SiteEnv).ADMIN_PASSWORD);
}

async function getPickupCodePepper() {
	const { env } = await getCloudflareContext({ async: true });
	const pepper = (env as SiteEnv).PICKUP_CODE_PEPPER?.trim();
	if (!pepper) {
		throw new Error("PICKUP_CODE_PEPPER secret is not configured.");
	}

	return pepper;
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
	return (await getSiteAuthSession(sitePassword, token)).valid;
}

export async function getSiteAuthSession(sitePassword: string | null, token?: string | null): Promise<AuthSessionValidation> {
	if (!isSiteLockEnabled(sitePassword)) {
		return { valid: true, csrfToken: null };
	}

	if (!token) {
		return { valid: false, csrfToken: null };
	}

	const { db } = await getCloudflareBindings();
	if (!db) {
		return { valid: false, csrfToken: null };
	}

	return validateAuthSession(db, "site", sitePassword, token);
}

export async function isAdminAuthTokenValid(adminPassword: string | null, token?: string | null) {
	return (await getAdminAuthSession(adminPassword, token)).valid;
}

export async function getAdminAuthSession(adminPassword: string | null, token?: string | null): Promise<AuthSessionValidation> {
	if (!adminPassword || !token) {
		return { valid: false, csrfToken: null };
	}

	const { db } = await getCloudflareBindings();
	if (!db) {
		return { valid: false, csrfToken: null };
	}

	return validateAuthSession(db, "admin", adminPassword, token);
}

export async function isSiteRequestAuthorized(request: Request) {
	if (await getDemoMode()) {
		return true;
	}

	const sitePassword = await getSitePassword();
	return isSiteAuthTokenValid(sitePassword, getCookieValue(request.headers.get("cookie"), SITE_AUTH_COOKIE));
}

export async function isAdminRequestAuthorized(request: Request) {
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
	const adminPassword = await getAdminPassword();
	if (!adminPassword) {
		return json({ error: "Admin password is not configured." }, 503);
	}

	if (await isAdminAuthTokenValid(adminPassword, getCookieValue(request.headers.get("cookie"), ADMIN_AUTH_COOKIE))) {
		return null;
	}

	return json({ error: "Admin password is required." }, 401);
}

export async function requireCsrf(request: Request, kind: AuthKind) {
	if (isSafeHttpMethod(request.method)) {
		return null;
	}

	const password = kind === "site" ? await getSitePassword() : await getAdminPassword();
	if (kind === "site" && !isSiteLockEnabled(password)) {
		return null;
	}

	if (!password) {
		return json({ error: "Authentication is not configured." }, 503);
	}

	const cookieHeader = request.headers.get("cookie");
	const authCookieName = kind === "site" ? SITE_AUTH_COOKIE : ADMIN_AUTH_COOKIE;
	const csrfCookieName = kind === "site" ? SITE_CSRF_COOKIE : ADMIN_CSRF_COOKIE;
	const authToken = getCookieValue(cookieHeader, authCookieName);
	const csrfCookie = getCookieValue(cookieHeader, csrfCookieName);
	const csrfHeader = request.headers.get("x-csrf-token");

	if (!authToken || !csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
		return json({ error: "CSRF token is required." }, 403);
	}

	const { db } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const session = await validateAuthSession(db, kind, password, authToken);
	if (!session.valid || session.csrfToken !== csrfHeader) {
		return json({ error: "CSRF token is invalid or expired." }, 403);
	}

	return null;
}

export async function requireWritableMode() {
	if (await getDemoMode()) {
		return json({ error: "Demo mode is read-only." }, 403);
	}

	return null;
}

export async function createSiteAuthSession(db: LockerDb, sitePassword: string, request: Request, now = Date.now()) {
	return createAuthSession(db, "site", sitePassword, request, now);
}

export async function createAdminAuthSession(db: LockerDb, adminPassword: string, request: Request, now = Date.now()) {
	return createAuthSession(db, "admin", adminPassword, request, now);
}

export async function isSecretEqual(input: string, expected: string) {
	const [inputBytes, expectedBytes] = await Promise.all([
		secretDigestBytes(input),
		secretDigestBytes(expected),
	]);
	let difference = inputBytes.length ^ expectedBytes.length;

	for (let index = 0; index < Math.max(inputBytes.length, expectedBytes.length); index += 1) {
		difference |= (inputBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
	}

	return difference === 0;
}

export async function getAuthLockStatus(db: LockerDb, kind: AuthKind, request: Request, now = Date.now()): Promise<AuthLockStatus> {
	const subjectHash = await getAuthSubjectHash(kind, request);
	const row = await db
		.prepare(
			`SELECT failure_count, window_started_at, locked_until
			FROM auth_login_failures
			WHERE subject_hash = ?`,
		)
		.bind(subjectHash)
		.first<AuthLoginFailureRow>();

	if (!row) {
		return { locked: false, retryAfterSeconds: 0 };
	}

	const windowExpired = now - Number(row.window_started_at) > AUTH_FAILURE_WINDOW_MS;
	const lockedUntil = Number(row.locked_until ?? 0);
	if (windowExpired || lockedUntil <= now) {
		return { locked: false, retryAfterSeconds: 0 };
	}

	return {
		locked: true,
		retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000)),
	};
}

export async function recordAuthFailure(db: LockerDb, kind: AuthKind, request: Request, now = Date.now()) {
	const subjectHash = await getAuthSubjectHash(kind, request);
	const row = await db
		.prepare(
			`SELECT failure_count, window_started_at
			FROM auth_login_failures
			WHERE subject_hash = ?`,
		)
		.bind(subjectHash)
		.first<AuthLoginFailureRow>();
	const currentWindowStartedAt = Number(row?.window_started_at ?? now);
	const isCurrentWindow = row !== null && now - currentWindowStartedAt <= AUTH_FAILURE_WINDOW_MS;
	const nextFailureCount = isCurrentWindow ? Number(row.failure_count) + 1 : 1;
	const nextWindowStartedAt = isCurrentWindow ? currentWindowStartedAt : now;
	const lockedUntil =
		nextFailureCount >= AUTH_LOCK_THRESHOLD
			? now + Math.min(AUTH_LOCK_MAX_MS, AUTH_LOCK_BASE_MS * 2 ** (nextFailureCount - AUTH_LOCK_THRESHOLD))
			: null;

	await db
		.prepare(
			`INSERT INTO auth_login_failures (
				subject_hash,
				auth_kind,
				failure_count,
				window_started_at,
				locked_until,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(subject_hash) DO UPDATE SET
				auth_kind = excluded.auth_kind,
				failure_count = excluded.failure_count,
				window_started_at = excluded.window_started_at,
				locked_until = excluded.locked_until,
				updated_at = excluded.updated_at`,
		)
		.bind(subjectHash, kind, nextFailureCount, nextWindowStartedAt, lockedUntil, now)
		.run();

	return {
		failureCount: nextFailureCount,
		lockedUntil,
		retryAfterSeconds: lockedUntil ? Math.max(1, Math.ceil((lockedUntil - now) / 1000)) : 0,
	};
}

export async function clearAuthFailures(db: LockerDb, kind: AuthKind, request: Request) {
	const subjectHash = await getAuthSubjectHash(kind, request);
	await db.prepare("DELETE FROM auth_login_failures WHERE subject_hash = ?").bind(subjectHash).run();
}

export async function cleanupAuthArtifacts(db: LockerDb, now = Date.now()) {
	await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now).run();
	await db.prepare("DELETE FROM auth_login_failures WHERE updated_at <= ?").bind(now - AUTH_FAILURE_RETENTION_MS).run();
}

export function serializeSiteAuthCookies(session: AuthSession, requestUrl: string) {
	return serializeAuthCookies("site", session, requestUrl);
}

export function serializeAdminAuthCookies(session: AuthSession, requestUrl: string) {
	return serializeAuthCookies("admin", session, requestUrl);
}

function serializeAuthCookies(kind: AuthKind, session: AuthSession, requestUrl: string) {
	const authCookieName = kind === "site" ? SITE_AUTH_COOKIE : ADMIN_AUTH_COOKIE;
	const csrfCookieName = kind === "site" ? SITE_CSRF_COOKIE : ADMIN_CSRF_COOKIE;
	const maxAge = kind === "site" ? SITE_AUTH_MAX_AGE : ADMIN_AUTH_MAX_AGE;

	return [
		serializeCookie(authCookieName, session.token, requestUrl, {
			httpOnly: true,
			maxAge,
		}),
		serializeCookie(csrfCookieName, session.csrfToken, requestUrl, {
			httpOnly: false,
			maxAge,
		}),
	];
}

function serializeCookie(
	name: string,
	value: string,
	requestUrl: string,
	options: {
		httpOnly: boolean;
		maxAge: number;
	},
) {
	const url = new URL(requestUrl);
	const parts = [
		`${name}=${value}`,
		"Path=/",
		"SameSite=Lax",
		`Max-Age=${options.maxAge}`,
		"Priority=High",
	];

	if (options.httpOnly) {
		parts.push("HttpOnly");
	}

	if (url.protocol === "https:") {
		parts.push("Secure");
	}

	return parts.join("; ");
}

async function createAuthSession(db: LockerDb, kind: AuthKind, password: string, request: Request, now: number): Promise<AuthSession> {
	const token = createCode(32);
	const csrfToken = createCode(16);
	const expiresAt = now + (kind === "site" ? SITE_AUTH_MAX_AGE : ADMIN_AUTH_MAX_AGE) * 1000;
	const source = getRequestSource(request);

	await db
		.prepare(
			`INSERT INTO auth_sessions (
				token_hash,
				auth_kind,
				password_hash,
				csrf_token,
				expires_at,
				created_at,
				ip,
				user_agent
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(await hashAuthToken(token), kind, await hashAuthPassword(kind, password), csrfToken, expiresAt, now, source.ip, source.userAgent)
		.run();

	return {
		token,
		csrfToken,
		expiresAt: new Date(expiresAt).toISOString(),
	};
}

async function validateAuthSession(db: LockerDb, kind: AuthKind, password: string, token: string): Promise<AuthSessionValidation> {
	const now = Date.now();
	const row = await db
		.prepare(
			`SELECT csrf_token
			FROM auth_sessions
			WHERE token_hash = ?
				AND auth_kind = ?
				AND password_hash = ?
				AND expires_at > ?`,
		)
		.bind(await hashAuthToken(token), kind, await hashAuthPassword(kind, password), now)
		.first<{ csrf_token: string }>();

	return {
		valid: row !== null,
		csrfToken: row?.csrf_token ?? null,
	};
}

async function hashAuthToken(token: string) {
	return hashText(`auth-session:${token}`);
}

async function hashAuthPassword(kind: AuthKind, password: string) {
	return hashText(`auth-password:${kind}:${password}`);
}

async function getAuthSubjectHash(kind: AuthKind, request: Request) {
	const ip = getRequestIp(request) ?? "unknown";
	return hashText(`auth-failure:v2:${kind}:${ip}`);
}

async function secretDigestBytes(value: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return new Uint8Array(digest);
}

function isSafeHttpMethod(method: string) {
	return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function json(data: unknown, init?: ResponseInit | number) {
	const responseInit = typeof init === "number" ? { status: init } : init;
	const headers = new Headers(responseInit?.headers);
	headers.set("cache-control", "no-store");

	return Response.json(data, {
		...responseInit,
		headers,
	});
}

export async function createPickupPowChallenge(db: LockerDb, request: Request) {
	const difficulty = await getPickupPowDifficulty(db, request);
	const challenge = await cap.createChallenge({
		challengeCount: difficulty.challengeCount,
		challengeSize: difficulty.challengeSize,
		challengeDifficulty: difficulty.challengeDifficulty,
		expiresMs: CAP_CHALLENGE_MAX_AGE_MS,
	});

	return {
		...challenge,
		difficulty,
	};
}

export async function redeemPickupPowChallenge(token: string, solutions: number[]) {
	return cap.redeemChallenge({ token, solutions });
}

export async function validatePickupPowToken(token: string | null) {
	if (!token) {
		return "missing";
	}

	const result = await cap.validateToken(token);
	return result.success ? "valid" : "invalid";
}

export async function getPickupPowDifficulty(db: LockerDb, request: Request): Promise<PickupPowDifficulty> {
	const subjectHash = await getPickupPowSubjectHash(request);
	const now = Date.now();
	const row = await db
		.prepare(
			`SELECT failure_count, window_started_at
			FROM pickup_pow_failures
			WHERE subject_hash = ?`,
		)
		.bind(subjectHash)
		.first<PickupPowFailureRow>();
	const failureCount =
		row && now - Number(row.window_started_at) <= PICKUP_FAILURE_WINDOW_MS ? Number(row.failure_count) : 0;
	const tier = getPickupPowTier(failureCount);

	return {
		subjectHash,
		failureCount,
		challengeCount: tier.challengeCount,
		challengeSize: CAP_CHALLENGE_SIZE,
		challengeDifficulty: tier.challengeDifficulty,
	};
}

export async function recordPickupPowFailure(db: LockerDb, request: Request, now = Date.now()) {
	const subjectHash = await getPickupPowSubjectHash(request);
	const row = await db
		.prepare(
			`SELECT failure_count, window_started_at
			FROM pickup_pow_failures
			WHERE subject_hash = ?`,
		)
		.bind(subjectHash)
		.first<PickupPowFailureRow>();
	const currentWindowStartedAt = Number(row?.window_started_at ?? now);
	const isCurrentWindow = row !== null && now - currentWindowStartedAt <= PICKUP_FAILURE_WINDOW_MS;
	const nextFailureCount = isCurrentWindow ? Number(row.failure_count) + 1 : 1;
	const nextWindowStartedAt = isCurrentWindow ? currentWindowStartedAt : now;

	await db
		.prepare(
			`INSERT INTO pickup_pow_failures (
				subject_hash,
				failure_count,
				window_started_at,
				updated_at
			) VALUES (?, ?, ?, ?)
			ON CONFLICT(subject_hash) DO UPDATE SET
				failure_count = excluded.failure_count,
				window_started_at = excluded.window_started_at,
				updated_at = excluded.updated_at`,
		)
		.bind(subjectHash, nextFailureCount, nextWindowStartedAt, now)
		.run();

	return nextFailureCount;
}

export async function clearPickupPowFailure(db: LockerDb, request: Request) {
	const subjectHash = await getPickupPowSubjectHash(request);
	await db.prepare("DELETE FROM pickup_pow_failures WHERE subject_hash = ?").bind(subjectHash).run();
}

export async function createPickupAccessToken(db: LockerDb, pickupCodeHash: string, now = Date.now()) {
	const token = createCode(16);
	await db
		.prepare(
			`INSERT INTO pickup_access_tokens (
				token_hash,
				pickup_code_hash,
				expires_at,
				created_at
			) VALUES (?, ?, ?, ?)`,
		)
		.bind(await hashPickupAccessToken(token), pickupCodeHash, now + PICKUP_ACCESS_MAX_AGE_MS, now)
		.run();

	return {
		token,
		expiresAt: new Date(now + PICKUP_ACCESS_MAX_AGE_MS).toISOString(),
	};
}

export async function isPickupAccessTokenValid(db: LockerDb, pickupCodeHash: string, token: string | null, now = Date.now()) {
	if (!token) {
		return false;
	}

	const row = await db
		.prepare(
			`SELECT token_hash
			FROM pickup_access_tokens
			WHERE token_hash = ?
				AND pickup_code_hash = ?
				AND expires_at > ?`,
		)
		.bind(await hashPickupAccessToken(token), pickupCodeHash, now)
		.first<{ token_hash: string }>();

	return row !== null;
}

export async function cleanupPowArtifacts(db: LockerDb, now = Date.now()) {
	await deleteExpiredCapArtifacts(db, now);
	await db.prepare("DELETE FROM pickup_access_tokens WHERE expires_at <= ?").bind(now).run();
	await db.prepare("DELETE FROM pickup_pow_failures WHERE updated_at <= ?").bind(now - PICKUP_FAILURE_RETENTION_MS).run();
}

async function deleteExpiredCapArtifacts(db: LockerDb, now: number) {
	await db.prepare("DELETE FROM cap_challenges WHERE expires_at <= ?").bind(now).run();
	await db.prepare("DELETE FROM cap_tokens WHERE expires_at <= ?").bind(now).run();
}

async function getPickupPowSubjectHash(request: Request) {
	const ip = getRequestIp(request) ?? "unknown";
	const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? "";
	return hashText(`pickup-pow:${ip}\n${userAgent}`);
}

function getPickupPowTier(failureCount: number) {
	if (failureCount >= 11) {
		return { challengeCount: 200, challengeDifficulty: 5 };
	}

	if (failureCount >= 7) {
		return { challengeCount: 120, challengeDifficulty: 5 };
	}

	if (failureCount >= 4) {
		return { challengeCount: 80, challengeDifficulty: 4 };
	}

	if (failureCount >= 2) {
		return { challengeCount: 40, challengeDifficulty: 4 };
	}

	return { challengeCount: 20, challengeDifficulty: 3 };
}

async function hashPickupAccessToken(token: string) {
	return hashText(`pickup-access:${token}`);
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

export async function recordDeliveryEvent(db: LockerDb, input: DeliveryEventInput) {
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
	if (value === UNLIMITED_EXPIRY) {
		return value;
	}

	if (!ALLOWED_EXPIRY_HOURS.has(value)) {
		return null;
	}

	return value;
}

export function parseMaxDownloads(request: Request) {
	const value = Number(request.headers.get("x-max-downloads") ?? "1");
	if (value === UNLIMITED_DOWNLOADS) {
		return value;
	}

	if (!Number.isInteger(value) || value < MIN_DOWNLOADS) {
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
		code = Array.from({ length: PICKUP_CODE_LENGTH }, () => alphabet[randomIndex(alphabet.length)]).join("");
	} while (!/[A-Z]/.test(code) || !/[0-9]/.test(code));

	return code;
}

export async function createUniquePickupCode(db: LockerDb) {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const code = createPickupCode();
		const [pickupCodeHash, legacyPickupCodeHash] = await getPickupCodeHashCandidates(code);
		const existing = await db
			.prepare("SELECT id FROM file_deliveries WHERE pickup_code_hash IN (?, ?) LIMIT 1")
			.bind(pickupCodeHash, legacyPickupCodeHash)
			.first<{ id: string }>();

		if (!existing) {
			return { code, hash: pickupCodeHash };
		}
	}

	throw new Error("Unable to generate a unique pickup code.");
}

export async function hashContentBytes(bytes: ArrayBuffer) {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return bytesToHex(new Uint8Array(digest));
}

export async function findReusableStoredObject(db: LockerDb, bucket: LockerBucket, contentHash: string, size: number, now = Date.now()) {
	const rows = await db
		.prepare(
			`SELECT COALESCE(storage_key, object_key) AS storage_key
			FROM file_deliveries
			WHERE content_hash = ?
				AND size = ?
				AND deleted_at IS NULL
				AND (expires_at = ? OR expires_at > ?)
				AND (max_downloads = ? OR download_count < max_downloads)
			ORDER BY created_at DESC
			LIMIT 5`,
		)
		.bind(contentHash, size, UNLIMITED_EXPIRY, now, UNLIMITED_DOWNLOADS)
		.all<{ storage_key: string }>();

	for (const row of rows.results ?? []) {
		const storageKey = row.storage_key;
		if (storageKey && (await bucket.get(storageKey))) {
			return storageKey;
		}
	}

	return null;
}

export async function deleteStoredObjectIfUnreferenced(db: LockerDb, bucket: LockerBucket, storageKey: string, now = Date.now()) {
	const activeReference = await db
		.prepare(
			`SELECT id
			FROM file_deliveries
			WHERE COALESCE(storage_key, object_key) = ?
				AND deleted_at IS NULL
				AND (expires_at = ? OR expires_at > ?)
				AND (max_downloads = ? OR download_count < max_downloads)
			LIMIT 1`,
		)
		.bind(storageKey, UNLIMITED_EXPIRY, now, UNLIMITED_DOWNLOADS)
		.first<{ id: string }>();

	if (!activeReference) {
		await bucket.delete(storageKey);
	}
}

export function normalizePickupCode(value: string) {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, PICKUP_CODE_LENGTH);
}

export function isValidPickupCode(value: string) {
	return /^[A-Z0-9]{6}$/.test(value.trim().toUpperCase());
}

export async function hashPickupCode(code: string) {
	const normalizedCode = normalizePickupCode(code);
	const digest = await hmacSha256Hex(await getPickupCodePepper(), `pickup-code:${normalizedCode}`);
	return `hmac-sha256:${digest}`;
}

export async function getPickupCodeHashCandidates(code: string) {
	const normalizedCode = normalizePickupCode(code);
	return [await hashPickupCode(normalizedCode), await hashLegacyCode(normalizedCode)];
}

export async function hashManageCode(code: string) {
	return hashLegacyCode(code);
}

async function hashLegacyCode(code: string) {
	return hashText(code.trim().toUpperCase());
}

async function hashText(value: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, value: string) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
	return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
	const hasUnlimitedDownloads = row.max_downloads === UNLIMITED_DOWNLOADS;
	const remainingDownloads = hasUnlimitedDownloads ? null : Math.max(0, row.max_downloads - row.download_count);
	let status: DeliveryPublic["status"] = "available";

	if (row.deleted_at !== null) {
		status = "deleted";
	} else if (row.expires_at !== UNLIMITED_EXPIRY && row.expires_at <= now) {
		status = "expired";
	} else if (!hasUnlimitedDownloads && remainingDownloads < 1) {
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
		expiresAt: row.expires_at === UNLIMITED_EXPIRY ? null : new Date(row.expires_at).toISOString(),
		createdAt: new Date(row.created_at).toISOString(),
		status,
	};
}

export function isUnavailable(row: DeliveryRow, now = Date.now()) {
	if (row.deleted_at !== null) {
		return "deleted";
	}

	if (row.expires_at !== UNLIMITED_EXPIRY && row.expires_at <= now) {
		return "expired";
	}

	if (row.max_downloads !== UNLIMITED_DOWNLOADS && row.download_count >= row.max_downloads) {
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
