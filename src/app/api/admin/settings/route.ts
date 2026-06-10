import {
	type LockerDb,
	type StorageSettingsUpdate,
	getCloudflareDb,
	getPublicStorageSettings,
	getUploadSettings,
	json,
	requireAdminAuth,
	requireCsrf,
	requireWritableMode,
	saveStorageSettings,
	saveUploadSettings,
} from "@/lib/locker";

type SettingsRequestBody = {
	storage?: StorageSettingsUpdate;
	upload?: {
		customPickupCodeEnabled?: boolean;
	};
};

export async function GET(request: Request) {
	const unauthorized = await requireAdminAuth(request);
	if (unauthorized) {
		return unauthorized;
	}

	const db = await getCloudflareDb();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const [storage, upload] = await Promise.all([getPublicStorageSettings(db), getUploadSettings(db)]);
	return json({ storage, upload });
}

export async function PATCH(request: Request) {
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

	const db = await getCloudflareDb();
	if (!db) {
		return json({ error: "Cloudflare bindings are not available." }, 500);
	}

	const body = await readSettingsRequest(request);
	if (!body) {
		return json({ error: "Invalid settings request." }, 400);
	}

	if (body.storage) {
		const error = await validateStorageSettings(db, body.storage);
		if (error) {
			return json({ error }, 400);
		}
		await saveStorageSettings(db, body.storage);
	}

	if (body.upload) {
		await saveUploadSettings(db, {
			customPickupCodeEnabled: body.upload.customPickupCodeEnabled !== false,
		});
	}

	const [storage, upload] = await Promise.all([getPublicStorageSettings(db), getUploadSettings(db)]);
	return json({ ok: true, storage, upload });
}

async function readSettingsRequest(request: Request): Promise<SettingsRequestBody | null> {
	try {
		const body = (await request.json()) as SettingsRequestBody;
		return typeof body === "object" && body !== null ? body : null;
	} catch {
		return null;
	}
}

async function validateStorageSettings(db: LockerDb, storage: StorageSettingsUpdate) {
	if (storage.backend !== "r2" && storage.backend !== "s3") {
		return "Invalid storage backend.";
	}

	if (storage.backend === "r2") {
		return null;
	}

	const s3 = storage.s3 ?? {};
	if (!s3.endpoint?.trim() || !s3.bucket?.trim() || !s3.region?.trim() || !s3.accessKeyId?.trim()) {
		return "S3 endpoint, bucket, region, and access key are required.";
	}

	try {
		const endpointUrl = new URL(s3.endpoint.trim());
		if (endpointUrl.protocol !== "https:" && endpointUrl.protocol !== "http:") {
			return "S3 endpoint must be an HTTP or HTTPS URL.";
		}
	} catch {
		return "S3 endpoint must be a valid URL.";
	}

	const current = await getPublicStorageSettings(db);
	if (!s3.secretAccessKey?.trim() && !current.s3.secretAccessKeySet) {
		return "S3 secret access key is required.";
	}

	return null;
}
