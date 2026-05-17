import {
	type DeliveryRow,
	getPickupCodeHashCandidates,
	getCloudflareBindings,
	isPickupAccessTokenValid,
	isValidPickupCode,
	json,
	normalizePickupCode,
	requireSiteAuth,
} from "@/lib/locker";
import { createDeliveryDownloadResponse } from "../../download-response";

export async function GET(request: Request, context: { params: Promise<{ pickupCode: string }> }) {
	const unauthorized = await requireSiteAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const { db, bucket, ctx, demoMode } = await getCloudflareBindings();
	if (!db || !bucket) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
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
				guest_access_token_hash,
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

	return createDeliveryDownloadResponse({ request, db, bucket, ctx, row, demoMode });
}
