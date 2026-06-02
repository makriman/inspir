function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .flatMap((email) => {
      const normalized = email.trim().toLowerCase();
      return normalized ? [normalized] : [];
    });
}

export function isAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
