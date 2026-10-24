// Place lookups use OpenStreetMap's public Nominatim service, called from the browser only when the user asks.
type Address = Record<string, string | undefined>;

export function buildLabel(a: Address): string {
  const local = a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet || "";
  const city = a.city || a.town || a.municipality || a.county || "";
  const parts = [local, city, a.state || ""].filter(Boolean);
  return [...new Set(parts)].join(", ").slice(0, 120);
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${lat}&lon=${lng}`);
    if (!r.ok) return null;
    const j = await r.json();
    const label = buildLabel(j.address ?? {});
    if (label) return label;
    return j.display_name ? String(j.display_name).split(",").slice(0, 3).join(",").trim().slice(0, 120) : null;
  } catch { return null; }
}

export async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || !j[0]) return null;
    return { lat: Number(j[0].lat), lng: Number(j[0].lon), label: buildLabel(j[0].address ?? {}) || query };
  } catch { return null; }
}

export function getPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Your browser can't share location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(4)), lng: Number(p.coords.longitude.toFixed(4)) }),
      () => reject(new Error("Location permission was denied. You can still type a place name.")),
      { timeout: 10_000 },
    );
  });
}
