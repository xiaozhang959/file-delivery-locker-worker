import { getCloudflareBindings, json, requireAdminAuth } from "@/lib/locker";

type AdminDeliveryRow = {
	id: string;
	file_name: string;
	content_type: string;
	delivery_kind: "file" | "text";
	size: number;
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
	status: "available" | "expired" | "deleted" | "depleted";
};

type CountRow = {
	total: number;
};

const allowedStatuses = new Set(["available", "expired", "deleted", "depleted"]);
const allowedKinds = new Set(["file", "text"]);

export async function GET(request: Request) {
	const unauthorized = await requireAdminAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const url = new URL(request.url);
	const page = clampInteger(url.searchParams.get("page"), 1, 1, 9999);
	const pageSize = clampInteger(url.searchParams.get("pageSize"), 20, 1, 100);
	const now = Date.now();
	const filters: string[] = [];
	const bindings: Array<number | string> = [];

	const status = url.searchParams.get("status")?.trim();
	if (status && allowedStatuses.has(status)) {
		filters.push("status = ?");
		bindings.push(status);
	}

	const kind = url.searchParams.get("kind")?.trim();
	if (kind && allowedKinds.has(kind)) {
		filters.push("delivery_kind = ?");
		bindings.push(kind);
	}

	const keyword = url.searchParams.get("q")?.trim();
	if (keyword) {
		const likeKeyword = `%${keyword.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		filters.push("(file_name LIKE ? ESCAPE '\\' OR id = ? OR upload_ip LIKE ? ESCAPE '\\')");
		bindings.push(likeKeyword, keyword, likeKeyword);
	}

	const baseQuery = `
		FROM (
			SELECT
				id,
				file_name,
				content_type,
				delivery_kind,
				size,
				max_downloads,
				download_count,
				expires_at,
				created_at,
				deleted_at,
				deleted_reason,
				upload_ip,
				upload_user_agent,
				upload_browser,
				upload_os,
				upload_device,
				upload_country,
				upload_region,
				upload_city,
				CASE
					WHEN deleted_at IS NOT NULL THEN 'deleted'
					WHEN expires_at <= ? THEN 'expired'
					WHEN download_count >= max_downloads THEN 'depleted'
					ELSE 'available'
				END AS status
			FROM file_deliveries
		) deliveries
		${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
	`;
	const queryBindings = [now, ...bindings];
	const offset = (page - 1) * pageSize;

	try {
		const countRow = await db
			.prepare(`SELECT COUNT(*) AS total ${baseQuery}`)
			.bind(...queryBindings)
			.first<CountRow>();
		const rows = await db
			.prepare(
				`SELECT *
				${baseQuery}
				ORDER BY created_at DESC
				LIMIT ? OFFSET ?`,
			)
			.bind(...queryBindings, pageSize, offset)
			.all<AdminDeliveryRow>();

		const total = Number(countRow?.total ?? 0);
		return json({
			deliveries: (rows.results ?? []).map(serializeAdminDelivery),
			page,
			pageSize,
			total,
			totalPages: Math.max(1, Math.ceil(total / pageSize)),
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "admin_deliveries_read_failed",
				error: error instanceof Error ? error.message : "unknown",
			}),
		);
		return json({ error: "Unable to read deliveries." }, 500);
	}
}

function serializeAdminDelivery(row: AdminDeliveryRow) {
	return {
		id: row.id,
		fileName: row.file_name,
		contentType: row.content_type,
		kind: row.delivery_kind,
		size: row.size,
		maxDownloads: row.max_downloads,
		downloadCount: row.download_count,
		remainingDownloads: Math.max(0, row.max_downloads - row.download_count),
		expiresAt: new Date(row.expires_at).toISOString(),
		createdAt: new Date(row.created_at).toISOString(),
		deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
		deletedReason: row.deleted_reason,
		status: row.status,
		upload: {
			ip: row.upload_ip,
			userAgent: row.upload_user_agent,
			browser: row.upload_browser,
			os: row.upload_os,
			device: row.upload_device,
			country: row.upload_country,
			region: row.upload_region,
			city: row.upload_city,
		},
	};
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
	const parsed = Number(value ?? fallback);
	if (!Number.isInteger(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, parsed));
}
