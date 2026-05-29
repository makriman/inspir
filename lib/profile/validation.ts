import { z } from "zod";
import { supportedLanguages } from "@/lib/content/languages";
import { validateDateOfBirth } from "@/lib/profile/age";

export const updateProfileSchema = z.object({
  preferredLanguage: z.enum(supportedLanguages).optional(),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .refine((value) => value === undefined || validateDateOfBirth(value).success, {
      error: "Enter a valid date of birth.",
    }),
});
