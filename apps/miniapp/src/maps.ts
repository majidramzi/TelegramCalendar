/** Open coordinates in Apple Maps (iOS) or Google Maps (others / desktop). */
export function openInMaps(
  lat: number,
  lng: number,
  label?: string | null,
): void {
  const name = encodeURIComponent((label || "Event location").trim());
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const url = isIOS
    ? `https://maps.apple.com/?ll=${lat},${lng}&q=${name}`
    : `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;

  const wa = window.Telegram?.WebApp;
  if (wa?.openLink) wa.openLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
