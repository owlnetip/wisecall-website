import { z } from "zod";

export const demoRequestSchema = z.object({
  mobile: z
    .string()
    .trim()
    .min(7, "Enter a mobile number")
    .max(32, "Mobile number is too long"),
  websiteUrl: z
    .string()
    .trim()
    .url("Enter a valid website URL")
    .max(300, "Website URL is too long"),
  industry: z
    .string()
    .trim()
    .min(2, "Choose an industry")
    .max(80, "Industry is too long"),
  businessName: z
    .string()
    .trim()
    .max(120, "Business name is too long")
    .optional()
    .or(z.literal("")),
});

export const callbackSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(7, "Enter a mobile number")
    .max(32, "Mobile number is too long"),
  source: z.string().trim().max(120).default("portal_demo"),
});

export type DemoRequestInput = z.infer<typeof demoRequestSchema>;
