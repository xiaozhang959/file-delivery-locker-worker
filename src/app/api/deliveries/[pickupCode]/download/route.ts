import {
	type DeliveryRow,
	contentDisposition,
	getCloudflareBindings,
	hashCode,
	isUnavailable,
	json,
	requireSiteAuth,
} from "@/lib/locker";

export async function GET(request: Request, context: { params: Promise<{ pickupCode: string }> }) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, bucket, ctx } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { pickupCode } = await context.params;
	const pickupCodeHash = await hashCode(pickupCode);
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
			WHERE pickup_code_hash = ?`,
		)
		.bind(pickupCodeHash)
		.first<DeliveryRow>();

	if (!row) {
		return json({ error: "Delivery not found." }, 404);
	}

	const now = Date.now();
	const unavailable = isUnavailable(row, now);
	if (unavailable) {
		if (unavailable === "expired" && row.deleted_at === null) {
			ctx.waitUntil(markDeleted(db, bucket, row, now, "expired"));
		}

		return json({ error: `Delivery is ${unavailable}.` }, 410);
	}

	const object = await bucket.get(row.object_key);
	if (!object) {
		ctx.waitUntil(markDeleted(db, bucket, row, now, "missing_object"));
		return json({ error: "Stored file is missing." }, 404);
	}

	const reachedLimit = row.download_count + 1 >= row.max_downloads;
	const result = await db
		.prepare(
			`UPDATE file_deliveries
			SET
				download_count = download_count + 1,
				deleted_at = CASE WHEN download_count + 1 >= max_downloads THEN ? ELSE deleted_at END,
				deleted_reason = CASE WHEN download_count + 1 >= max_downloads THEN 'downloaded' ELSE deleted_reason END
			WHERE id = ?
				AND deleted_at IS NULL
				AND expires_at > ?
				AND download_count < max_downloads`,
		)
		.bind(now, row.id, now)
		.run();

	if (Number(result.meta.changes ?? 0) !== 1) {
		return json({ error: "Delivery is no longer available." }, 409);
	}

	if (reachedLimit) {
		ctx.waitUntil(bucket.delete(row.object_key));
	}

	return new Response(object.body, {
		headers: {
			"cache-control": "no-store",
			"content-disposition": contentDisposition(row.file_name),
			"content-length": String(object.size),
			"content-type": object.httpMetadata?.contentType ?? row.content_type,
			etag: object.httpEtag,
		},
	});
}

async function markDeleted(db: D1Database, bucket: R2Bucket, row: DeliveryRow, now: number, reason: string) {
	await db
		.prepare("UPDATE file_deliveries SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL")
		.bind(now, reason, row.id)
		.run();
	await bucket.delete(row.object_key);
}
