import GuestDownloadPage from "./guest-download-page";

export default async function Page({ params }: { params: Promise<{ guestToken: string }> }) {
	const { guestToken } = await params;
	return <GuestDownloadPage guestToken={guestToken} />;
}
