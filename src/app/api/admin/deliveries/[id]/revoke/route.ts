import {
	type DeliveryRow,
	getCloudflareBindings,
	getRequestSource,
	json,
	recordDeliveryEvent,
	requireAdminAuth,
	requireCsrf,
	requireWritableMode,
} from "@/lib/locker";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	const readonly = await requireWritableMode();
	if (readonly) {
		return readonly;
	}

	const unauthorized = await requireAdminAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const csrf = await requireCsrf(request, "admin");
	if (csrf) {
		return csrf;
	}

	const { db, bucket } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { id } = await context.params;
	const row = await db
		.prepare(
			`SELECT
				id,
				object_key,
				file_name,
				content_type,
				delivery_kind,
				size,
				pickup_code_hash,
				manage_code_hash,
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
				upload_city
			FROM file_deliveries
			WHERE id = ?`,
		)
		.bind(id)
		.first<DeliveryRow>();

	if (!row) {
		return json({ error: "Delivery not found." }, 404);
	}

	if (row.deleted_at !== null) {
		return json({ ok: true, deleted: true });
	}

	const now = Date.now();
	await db
		.prepare("UPDATE file_deliveries SET deleted_at = ?, deleted_reason = 'admin_revoked' WHERE id = ? AND deleted_at IS NULL")
		.bind(now, row.id)
		.run();
	await bucket.delete(row.object_key);
	await recordDeliveryEvent(db, {
		deliveryId: row.id,
		action: "admin_revoke",
		actor: "admin",
		source: getRequestSource(request),
		note: "admin_revoked",
		previousMaxDownloads: row.max_downloads,
		previousDownloadCount: row.download_count,
		nextMaxDownloads: row.max_downloads,
		nextDownloadCount: row.download_count,
		createdAt: now,
	});

	return json({ ok: true, deleted: true });
}
