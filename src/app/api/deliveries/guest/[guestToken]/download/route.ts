import {
	type DeliveryRow,
	getCloudflareBindings,
	hashGuestAccessToken,
	json,
	validatePickupPowToken,
} from "@/lib/locker";
import { createDeliveryDownloadResponse } from "../../../download-response";

export async function GET(request: Request, context: { params: Promise<{ guestToken: string }> }) {
	const { db, bucket, ctx, demoMode } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const powTokenStatus = await validatePickupPowToken(request.headers.get("x-cap-token"));
	if (powTokenStatus === "missing") {
		return json({ error: "Please complete the proof-of-work challenge." }, 428);
	}

	if (powTokenStatus === "invalid") {
		return json({ error: "Proof-of-work challenge is invalid or expired." }, 403);
	}

	const { guestToken } = await context.params;
	const token = guestToken.trim();
	if (!/^[a-fA-F0-9]{64}$/.test(token)) {
		return json({ error: "Guest download link is invalid." }, 400);
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
		return json({ error: "Guest download link was not found." }, 404);
	}

	if (row.delivery_kind === "text") {
		return json({ error: "Text deliveries are shown inline." }, 415);
	}

	return createDeliveryDownloadResponse({ request, db, bucket, ctx, row, demoMode, eventNote: "guest_access" });
}
