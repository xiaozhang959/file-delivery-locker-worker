export type DeliveryKind = "file" | "text";

export type UploadResult = {
	id: string;
	pickupCode: string;
	manageCode: string;
	fileName: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	expiresAt: string | null;
	pickupUrl: string;
	downloadUrl: string;
};

export type Delivery = {
	id: string;
	fileName: string;
	contentType: string;
	kind: DeliveryKind;
	size: number;
	maxDownloads: number;
	downloadCount: number;
	remainingDownloads: number | null;
	expiresAt: string | null;
	createdAt: string;
	status: "available" | "expired" | "deleted" | "depleted";
};

export type DeliveryLookupResult = {
	delivery: Delivery;
	pickupAccessToken: string;
	pickupAccessExpiresAt: string;
};

export type ApiError = {
	error?: string;
};

export type TextPreview = {
	text: string;
	remainingDownloads: number | null;
};

export type SiteStats = {
	uploadCount: number;
	downloadCount: number;
};
