import {
	deleteStoredObjectIfUnreferenced,
	type DeliveryRow,
	getCloudflareBindings,
	hashManageCode,
	json,
	requireCsrf,
	requireSiteAuth,
	requireWritableMode,
} from "@/lib/locker";

export async function DELETE(request: Request, context: { params: Promise<{ manageCode: string }> }) {
	const readonly = await requireWritableMode();
	if (readonly) {
		return readonly;
	}

	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const csrf = await requireCsrf(request, "site");
	if (csrf) {
		return csrf;
	}

	const { db, bucket } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { manageCode } = await context.params;
	const manageCodeHash = await hashManageCode(manageCode);
	const row = await db
		.prepare(
			`SELECT
				id,
				object_key,
				COALESCE(storage_key, object_key) AS storage_key,
				file_name,
				content_type,
				delivery_kind,
				size,
				content_hash,
				pickup_code_hash,
				manage_code_hash,
				max_downloads,
				download_count,
				expires_at,
				created_at,
				deleted_at,
				deleted_reason
			FROM file_deliveries
			WHERE manage_code_hash = ?`,
		)
		.bind(manageCodeHash)
		.first<DeliveryRow>();

	if (!row) {
		return json({ error: "Delivery not found." }, 404);
	}

	if (row.deleted_at !== null) {
		return json({ ok: true, deleted: true });
	}

	const now = Date.now();
	await db
		.prepare("UPDATE file_deliveries SET deleted_at = ?, deleted_reason = 'revoked' WHERE id = ? AND deleted_at IS NULL")
		.bind(now, row.id)
		.run();
	await deleteStoredObjectIfUnreferenced(db, bucket, row.storage_key, now);

	return json({ ok: true, deleted: true });
}
