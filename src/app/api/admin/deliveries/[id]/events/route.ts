import { getCloudflareBindings, json, requireAdminAuth } from "@/lib/locker";

type DeliveryEventRow = {
	id: string;
	delivery_id: string;
	action: string;
	actor: string;
	ip: string | null;
	user_agent: string | null;
	browser: string | null;
	os: string | null;
	device: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	note: string | null;
	previous_max_downloads: number | null;
	previous_download_count: number | null;
	next_max_downloads: number | null;
	next_download_count: number | null;
	created_at: number;
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
	const unauthorized = await requireAdminAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { id } = await context.params;
	const rows = await db
		.prepare(
			`SELECT
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
			FROM delivery_events
			WHERE delivery_id = ?
			ORDER BY created_at DESC
			LIMIT 200`,
		)
		.bind(id)
		.all<DeliveryEventRow>();

	return json({
		events: (rows.results ?? []).map((row) => ({
			id: row.id,
			deliveryId: row.delivery_id,
			action: row.action,
			actor: row.actor,
			note: row.note,
			previousMaxDownloads: row.previous_max_downloads,
			previousDownloadCount: row.previous_download_count,
			nextMaxDownloads: row.next_max_downloads,
			nextDownloadCount: row.next_download_count,
			createdAt: new Date(row.created_at).toISOString(),
			source: {
				ip: row.ip,
				userAgent: row.user_agent,
				browser: row.browser,
				os: row.os,
				device: row.device,
				country: row.country,
				region: row.region,
				city: row.city,
			},
		})),
	});
}
