import { defaultLanguage } from "@/lib/content/languages";

export type UserProfile = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  score: number;
  preferredLanguage: string;
  dateOfBirth?: string | null;
  age?: number | null;
  createdAt: string | Date;
  profileImageHash?: string | null;
};

export type ApiProfileUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  score?: number | null;
  preferredLanguage?: string | null;
  dateOfBirth?: string | null;
  age?: number | null;
  createdAt: string | Date;
  profileImageHash?: string | null;
};

export type ProfileDetailsInput = {
  name: string;
  dateOfBirth: string | null;
  preferredLanguage: string;
};

export type ProfileResponse = {
  user?: ApiProfileUser;
  error?: string;
};

export function profileFromApiUser(user: ApiProfileUser): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    score: user.score ?? 0,
    preferredLanguage: user.preferredLanguage ?? defaultLanguage,
    dateOfBirth: user.dateOfBirth ?? null,
    age: user.age ?? null,
    createdAt: user.createdAt,
    profileImageHash: user.profileImageHash ?? null,
  };
}
