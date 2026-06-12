import { z } from "zod";
import { supportedLanguages } from "@/lib/content/languages";
import { validateDateOfBirth } from "@/lib/profile/age";

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(120, "Display name is too long.")
    .optional(),
  preferredLanguage: z.enum(supportedLanguages).optional(),
  dateOfBirth: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine((value) => value === undefined || value === null || validateDateOfBirth(value).success, {
      error: "Enter a valid date of birth.",
    }),
});
