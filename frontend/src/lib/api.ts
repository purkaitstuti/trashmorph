import { supabase } from "./supabase";

const BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof json?.detail === "string" ? json.detail : "Something went wrong. Please try again.";
    throw new ApiError(res.status, detail);
  }
  return json as T;
}

export type Profile = { id: string; email: string | null; full_name: string | null; avatar_url: string | null; preferred_location: string | null; role: string; recycler_organization: string | null; recycler_location: string | null; recycler_contact: string | null; created_at: string | null };
export type Settings = { theme: "light" | "dark" | "system"; notification_preferences: { in_app: boolean; email: boolean } };

/** Multipart upload with progress (fetch can't report upload progress). */
export async function uploadForm<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  const { data } = await supabase.auth.getSession();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    if (data.session) xhr.setRequestHeader("Authorization", `Bearer ${data.session.access_token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new ApiError(0, "Can't reach the server. Check your connection and try again."));
    xhr.onload = () => {
      let json: { detail?: unknown } | null = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(json as T);
      reject(new ApiError(xhr.status, typeof json?.detail === "string" ? json.detail : "Something went wrong. Please try again."));
    };
    xhr.send(form);
  });
}
