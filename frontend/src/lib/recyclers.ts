export type Recycler = {
  id: string; name: string; description: string | null; accepted_materials: string[]; recycler_type: string; latitude: number; longitude: number;
  address: string | null; contact_information: string | null; source: string; verification_status: string; distance_km: number | null; is_mine: boolean;
};
export const RECYCLER_TYPES: [string, string][] = [["recycling_center", "Recycling center"], ["scrap_dealer", "Scrap dealer"], ["ewaste_point", "E-waste collection point"], ["community_facility", "Community recycling facility"], ["composting", "Composting facility"], ["reuse_org", "Reuse organization"]];
export const typeLabel = (v: string) => RECYCLER_TYPES.find(([k]) => k === v)?.[1] ?? v;
export const VERIFICATION_LABEL: Record<string, string> = { verified: "Verified", community: "Community-submitted", pending: "Pending review (only you can see this)", rejected: "Rejected" };
export const directionsUrl = (r: Pick<Recycler, "latitude" | "longitude">) => `https://www.openstreetmap.org/directions?route=%3B${r.latitude}%2C${r.longitude}`;
