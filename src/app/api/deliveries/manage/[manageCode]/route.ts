import { type DeliveryRow, getCloudflareBindings, hashCode, json } from "@/lib/locker";

export async function DELETE(_request: Request, context: { params: Promise<{ manageCode: string }> }) {
	const { db, bucket } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { manageCode } = await context.params;
	const manageCodeHash = await hashCode(manageCode);
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

	await db
		.prepare("UPDATE file_deliveries SET deleted_at = ?, deleted_reason = 'revoked' WHERE id = ? AND deleted_at IS NULL")
		.bind(Date.now(), row.id)
		.run();
	await bucket.delete(row.object_key);

	return json({ ok: true, deleted: true });
}
