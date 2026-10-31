import { z } from "zod";

export const passwordRule = z.string().min(10, "Use at least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(100),
  email: z.string().trim().email("Enter a valid email address"),
  password: passwordRule,
  confirm: z.string(),
  terms: z.literal(true, { errorMap: () => ({ message: "Accept the terms to continue" }) }),
  accountType: z.enum(["user", "recycler"]).default("user"),
  recyclerOrganization: z.string().trim().max(160).default(""),
  recyclerLocation: z.string().trim().max(200).default(""),
  recyclerContact: z.string().trim().max(200).default(""),
}).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
  .superRefine((v, ctx) => {
    if (v.accountType !== "recycler") return;
    if (v.recyclerOrganization.length < 2) ctx.addIssue({ code: "custom", path: ["recyclerOrganization"], message: "Enter your organization name" });
    if (v.recyclerLocation.length < 2) ctx.addIssue({ code: "custom", path: ["recyclerLocation"], message: "Enter your organization location" });
    if (v.recyclerContact.length < 5) ctx.addIssue({ code: "custom", path: ["recyclerContact"], message: "Enter contact details" });
  });

export const loginSchema = z.object({ email: z.string().trim().email("Enter a valid email address"), password: z.string().min(1, "Enter your password") });
export const emailSchema = z.object({ email: z.string().trim().email("Enter a valid email address") });
export const resetSchema = z.object({ password: passwordRule, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
export const contactSchema = z.object({ name: z.string().trim().min(1, "Enter your name").max(100), email: z.string().trim().email("Enter a valid email address"), message: z.string().trim().min(10, "Write at least 10 characters").max(2000) });
export const profileSchema = z.object({ full_name: z.string().trim().min(1, "Enter your name").max(100), preferred_location: z.string().trim().max(120).optional() });
export const recyclerProfileSchema = z.object({
  organization: z.string().trim().min(2, "Enter your organization name").max(160),
  location: z.string().trim().min(2, "Enter your organization location").max(200),
  contact: z.string().trim().min(5, "Enter a contact number or email").max(200),
});

export const listingSchema = z.object({
  title: z.string().trim().min(3, "Use at least 3 characters").max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().min(1, "Choose a category"),
  quantity: z.string().refine((v) => Number(v) > 0 && Number(v) <= 1_000_000, "Enter a quantity above 0"),
  unit: z.string().min(1),
  condition: z.string().min(1, "Choose a condition"),
  listing_type: z.enum(["free", "exchange", "price"]),
  price: z.string().optional(),
  location_label: z.string().trim().min(2, "Enter a location").max(120),
}).superRefine((v, ctx) => {
  if (v.listing_type === "price" && (!v.price || !(Number(v.price) >= 0))) ctx.addIssue({ code: "custom", path: ["price"], message: "Enter a price" });
});

const todayOrLater = (v: string) => {
  if (!v) return false;
  const d = new Date(`${v}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return d >= t;
};
export const collectionSchema = z.object({
  quantity: z.string().refine((v) => Number(v) > 0 && Number(v) <= 1_000_000, "Enter a quantity above 0"),
  requested_date: z.string().refine(todayOrLater, "Choose today or a later date"),
  time_window: z.enum(["any", "morning", "afternoon", "evening"]),
  instructions: z.string().trim().max(500).optional(),
});
export const recyclerSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120),
  recycler_type: z.string().min(1, "Choose a type"),
  description: z.string().trim().max(1000).optional(),
  address: z.string().trim().max(200).optional(),
  contact_information: z.string().trim().max(200).optional(),
});
