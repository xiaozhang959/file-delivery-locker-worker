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

type CountsBody = {
	maxDownloads?: unknown;
	downloadCount?: unknown;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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

	const body = (await request.json().catch(() => null)) as CountsBody | null;
	const maxDownloads = Number(body?.maxDownloads);
	const downloadCount = Number(body?.downloadCount);

	if (!Number.isInteger(maxDownloads) || maxDownloads < 1) {
		return json({ error: "maxDownloads must be an integer greater than 0." }, 400);
	}

	if (!Number.isInteger(downloadCount) || downloadCount < 0) {
		return json({ error: "downloadCount must be an integer greater than or equal to 0." }, 400);
	}

	if (downloadCount > maxDownloads) {
		return json({ error: "downloadCount cannot exceed maxDownloads." }, 400);
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

	const now = Date.now();
	const shouldDeleteObject = row.deleted_at === null && row.expires_at > now && downloadCount >= maxDownloads;

	if (shouldDeleteObject) {
		await db
			.prepare(
				`UPDATE file_deliveries
				SET
					max_downloads = ?,
					download_count = ?,
					deleted_at = ?,
					deleted_reason = 'admin_count_limit'
				WHERE id = ?`,
			)
			.bind(maxDownloads, downloadCount, now, row.id)
			.run();
		await bucket.delete(row.object_key);
	} else {
		await db
			.prepare(
				`UPDATE file_deliveries
				SET max_downloads = ?, download_count = ?
				WHERE id = ?`,
			)
			.bind(maxDownloads, downloadCount, row.id)
			.run();
	}

	await recordDeliveryEvent(db, {
		deliveryId: row.id,
		action: "admin_counts_update",
		actor: "admin",
		source: getRequestSource(request),
		note: shouldDeleteObject ? "admin_count_limit" : null,
		previousMaxDownloads: row.max_downloads,
		previousDownloadCount: row.download_count,
		nextMaxDownloads: maxDownloads,
		nextDownloadCount: downloadCount,
		createdAt: now,
	});

	return json({
		ok: true,
		deleted: shouldDeleteObject || row.deleted_at !== null,
		deletedReason: shouldDeleteObject ? "admin_count_limit" : row.deleted_reason,
		maxDownloads,
		downloadCount,
	});
}
