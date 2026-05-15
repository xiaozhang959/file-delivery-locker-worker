import {
	type DeliveryRow,
	type LockerBucket,
	type LockerDb,
	UNLIMITED_DOWNLOADS,
	UNLIMITED_EXPIRY,
	cleanupPowArtifacts,
	contentDisposition,
	deleteStoredObjectIfUnreferenced,
	getPickupCodeHashCandidates,
	getCloudflareBindings,
	getRequestSource,
	isPickupAccessTokenValid,
	isValidPickupCode,
	isUnavailable,
	json,
	normalizePickupCode,
	recordDeliveryEvent,
	requireSiteAuth,
} from "@/lib/locker";

export async function GET(request: Request, context: { params: Promise<{ pickupCode: string }> }) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, bucket, ctx, demoMode } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	if (demoMode) {
		return json({ error: "Demo mode does not expose stored content." }, 403);
	}

	const { pickupCode } = await context.params;
	if (!isValidPickupCode(pickupCode)) {
		return json({ error: "Invalid pickup code." }, 400);
	}

	const pickupCodeHashes = await getPickupCodeHashCandidates(normalizePickupCode(pickupCode));
	const pickupAccessToken = request.headers.get("x-pickup-access-token");
	let pickupCodeHash: string | null = null;
	for (const candidateHash of pickupCodeHashes) {
		if (await isPickupAccessTokenValid(db, candidateHash, pickupAccessToken)) {
			pickupCodeHash = candidateHash;
			break;
		}
	}

	if (!pickupCodeHash) {
		return json({ error: "Pickup access token is missing, invalid, or expired." }, request.headers.has("x-pickup-access-token") ? 403 : 428);
	}

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
			WHERE pickup_code_hash = ?`,
		)
		.bind(pickupCodeHash)
		.first<DeliveryRow>();

	if (!row) {
		return json({ error: "Delivery not found." }, 404);
	}

	ctx.waitUntil(cleanupPowArtifacts(db).catch((error) => console.warn(error)));

	const now = Date.now();
	const source = getRequestSource(request);
	const unavailable = isUnavailable(row, now);
	if (unavailable) {
		if (!demoMode && unavailable === "expired" && row.deleted_at === null) {
			ctx.waitUntil(markDeleted(db, bucket, row, now, "expired"));
		}

		return json({ error: `Delivery is ${unavailable}.` }, 410);
	}

	const object = await bucket.get(row.storage_key);
	if (!object) {
		if (!demoMode) {
			ctx.waitUntil(markDeleted(db, bucket, row, now, "missing_object"));
		}
		return json({ error: "Stored file is missing." }, 404);
	}

	if (demoMode) {
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

	const reachedLimit = row.max_downloads !== UNLIMITED_DOWNLOADS && row.download_count + 1 >= row.max_downloads;
	const result = await db
		.prepare(
			`UPDATE file_deliveries
			SET
				download_count = download_count + 1,
				deleted_at = CASE WHEN max_downloads != ? AND download_count + 1 >= max_downloads THEN ? ELSE deleted_at END,
				deleted_reason = CASE WHEN max_downloads != ? AND download_count + 1 >= max_downloads THEN 'downloaded' ELSE deleted_reason END
			WHERE id = ?
				AND deleted_at IS NULL
				AND (expires_at = ? OR expires_at > ?)
				AND (max_downloads = ? OR download_count < max_downloads)`,
		)
		.bind(UNLIMITED_DOWNLOADS, now, UNLIMITED_DOWNLOADS, row.id, UNLIMITED_EXPIRY, now, UNLIMITED_DOWNLOADS)
		.run();

	if (Number(result.meta.changes ?? 0) !== 1) {
		return json({ error: "Delivery is no longer available." }, 409);
	}

	if (reachedLimit) {
		ctx.waitUntil(deleteStoredObjectIfUnreferenced(db, bucket, row.storage_key));
	}
	ctx.waitUntil(
		recordDeliveryEvent(db, {
			deliveryId: row.id,
			action: "download",
			actor: "user",
			source,
			nextMaxDownloads: row.max_downloads,
			nextDownloadCount: row.download_count + 1,
			createdAt: now,
		}).catch((error) => {
			console.error(
				JSON.stringify({
					event: "delivery_download_event_failed",
					id: row.id,
					error: error instanceof Error ? error.message : "unknown",
				}),
			);
		}),
	);

	return new Response(object.body, {
		headers: {
			"cache-control": "no-store",
			"content-disposition": contentDisposition(row.file_name),
			"content-length": String(object.size),
				"content-type": row.content_type,
				etag: object.httpEtag,
			},
		});
}

async function markDeleted(db: LockerDb, bucket: LockerBucket, row: DeliveryRow, now: number, reason: string) {
	await db
		.prepare("UPDATE file_deliveries SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL")
		.bind(now, reason, row.id)
		.run();
	await deleteStoredObjectIfUnreferenced(db, bucket, row.storage_key, now);
}
