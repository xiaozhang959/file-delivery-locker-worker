import {
	type DeliveryRow,
	getCloudflareBindings,
	hashGuestAccessToken,
	json,
	serializeDelivery,
} from "@/lib/locker";

export async function GET(_request: Request, context: { params: Promise<{ guestToken: string }> }) {
	const { db } = await getCloudflareBindings();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const { guestToken } = await context.params;
	const token = guestToken.trim();
	if (!/^[a-fA-F0-9]{64}$/.test(token)) {
		return json({ error: "Guest link is invalid." }, 400);
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
				guest_access_token_hash,
				max_downloads,
				download_count,
				expires_at,
				created_at,
				deleted_at,
				deleted_reason
			FROM file_deliveries
			WHERE guest_access_token_hash = ?`,
		)
		.bind(await hashGuestAccessToken(token))
		.first<DeliveryRow>();

	if (!row) {
		return json({ error: "Guest link was not found." }, 404);
	}

	return json({
		delivery: serializeDelivery(row),
	});
}
