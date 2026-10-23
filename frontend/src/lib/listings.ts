export type Listing = {
  id: string; owner_id: string; title: string; description: string | null; category: string; quantity: number; unit: string;
  condition: string; listing_type: "free" | "exchange" | "price"; price: number | null; latitude: number | null; longitude: number | null;
  location_label: string; status: string; images: string[]; created_at: string; updated_at: string;
};
export type ListingDetail = Listing & { seller: { id: string; full_name: string | null; avatar_url: string | null } | null; is_owner: boolean; is_favorite: boolean; has_inquired: boolean };
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type Inquiry = { id: string; listing_id: string; listing_title: string; other_party_name: string | null; message: string; reply_contact: string | null; status: string; created_at: string };
export type AppNotification = { id: string; title: string; message: string; notification_type: string; reference_id: string | null; read_at: string | null; created_at: string };

export const CATEGORIES: [string, string][] = [["plastic", "Plastic"], ["paper", "Paper"], ["cardboard", "Cardboard"], ["glass", "Glass"], ["metal", "Metal"], ["organic", "Organic waste"], ["electronic", "Electronic waste"], ["textile", "Textile"], ["general", "General"], ["other", "Other"]];
export const UNITS: [string, string][] = [["items", "items"], ["kg", "kg"], ["g", "g"], ["litres", "litres"], ["boxes", "boxes"], ["bags", "bags"]];
export const CONDITIONS: [string, string][] = [["like_new", "Like new"], ["good", "Good"], ["fair", "Fair"], ["scrap", "Scrap or for parts"]];
export const TYPES: [string, string][] = [["free", "Free"], ["exchange", "For exchange"], ["price", "Priced"]];
export const SORTS: [string, string][] = [["newest", "Newest"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]];
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Active", reserved: "Reserved", collected: "Collected", completed: "Completed", cancelled: "Unavailable" };
export const REPORT_REASONS: [string, string][] = [["spam", "Spam"], ["unsafe", "Unsafe item"], ["misleading", "Misleading"], ["prohibited", "Prohibited item"], ["other", "Something else"]];

// Owner actions per status. The server and database enforce the same transitions.
export const NEXT_ACTIONS: Record<string, [string, string][]> = {
  draft: [["active", "Publish"], ["cancelled", "Mark unavailable"]],
  active: [["reserved", "Mark reserved"], ["cancelled", "Mark unavailable"]],
  reserved: [["active", "Make available again"], ["collected", "Mark collected"], ["cancelled", "Mark unavailable"]],
  collected: [["completed", "Mark completed"]],
  completed: [], cancelled: [],
};

const find = (list: [string, string][], v: string) => list.find(([k]) => k === v)?.[1] ?? v;
export const categoryLabel = (v: string) => find(CATEGORIES, v);
export const conditionLabel = (v: string) => find(CONDITIONS, v);

export function priceLabel(l: Pick<Listing, "listing_type" | "price">): string {
  if (l.listing_type === "free") return "Free";
  if (l.listing_type === "exchange") return "For exchange";
  const currency = (import.meta.env.VITE_CURRENCY as string | undefined) || "USD";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(l.price ?? 0);
}

export const timeAgo = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
