export const MAX_IMAGE_MB = 5;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Client-side check for fast feedback. The server validates the real file content again. */
export function checkImage(file: Pick<File, "type" | "size">): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG or WebP image.";
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) return `Image must be ${MAX_IMAGE_MB} MB or smaller.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

export type ScanResult = {
  scan_id: string; category: string; confidence: number; is_uncertain: boolean; top_guess: string; suggested_action: string; recycling_guidance: string;
  alternatives: { label: string; category: string; confidence: number }[]; candidates: ScanCandidate[]; model_version: string; image_saved: boolean; disclaimer: string;
};
export type ScanCandidate = { candidate_id: string; region_label: string; bbox: [number, number, number, number] | number[]; category: string; confidence: number; is_uncertain: boolean; top_guess: string; suggested_action: string };
export type ScanItem = { id: string; category: string; confidence: number; top_guess: string | null; suggested_action: string; is_uncertain: boolean; image_url: string | null; created_at: string };
export type ScannerStatus = { available: boolean; reason: string | null; message: string | null; model_version: string | null };

export const scanCategoryLabel = (c: string, fallback: (v: string) => string) => (c === "uncertain" ? "Not sure" : fallback(c));
export const pct = (n: number) => `${Math.round(n * 100)}%`;
