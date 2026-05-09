import { type DeliveryRow, getCloudflareBindings, hashCode, json, serializeDelivery } from "@/lib/locker";

export async function GET(_request: Request, context: { params: Promise<{ pickupCode: string }> }) {
	const { db } = await getCloudflareBindings();
	if (!db) {
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

	return json({ delivery: serializeDelivery(row) });
}
