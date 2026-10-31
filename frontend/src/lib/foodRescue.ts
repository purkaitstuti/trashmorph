export type FoodOrganization = {
  id: string; name: string; organization_type: string; address: string; latitude: number; longitude: number;
  contact_number: string | null; website: string | null; operating_hours: string | null; donation_requirements: string | null; verification_status: "verified" | "needs_review"; distance_km: number | null;
};
export type FoodDonation = {
  id: string; donor_id: string; donor_type: string; donor_organization_name: string | null; title: string; food_category: string; description: string | null; quantity: number; unit: string;
  prepared_at: string; storage_conditions: string; allergens: string[]; pickup_deadline: string; location_label: string;
  latitude: number; longitude: number; photo_url: string | null; status: string; organization_id: string | null;
  reported_quantity: number | null; donated_at: string | null; verification: string; created_at: string; updated_at: string;
};
export const FOOD_CATEGORIES: [string, string][] = [["prepared_meal", "Prepared meals"], ["bakery", "Bakery"], ["produce", "Produce"], ["dairy", "Dairy"], ["packaged", "Packaged food"], ["other", "Other"]];
export const FOOD_UNITS: [string, string][] = [["servings", "servings"], ["kg", "kg"], ["g", "g"], ["boxes", "boxes"], ["bags", "bags"], ["items", "items"], ["litres", "litres"]];
export const ORG_TYPES: Record<string, string> = { food_bank: "Food bank", community_kitchen: "Community kitchen", shelter: "Shelter", ngo: "NGO", other: "Community organization" };
export const FOOD_STATUS: Record<string, string> = { available: "Available", donated: "Donor-reported donated", expired: "Expired", cancelled: "Cancelled" };
export const foodCategoryLabel = (key: string) => FOOD_CATEGORIES.find(([v]) => v === key)?.[1] ?? key;
export const foodDirectionsUrl = (o: Pick<FoodOrganization, "latitude" | "longitude">) => `https://www.openstreetmap.org/directions?route=%3B${o.latitude}%2C${o.longitude}`;
