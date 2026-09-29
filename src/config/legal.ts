/**
 * Who provides the service, for the terms and the privacy policy. Filled from the
 * environment so the documents never need a code change when the details do.
 */
export function legal() {
  return {
    /** full name of the self-employed provider (or the company) */
    name: process.env.LEGAL_NAME?.trim() || null,
    inn: process.env.LEGAL_INN?.trim() || null,
    email: process.env.SUPPORT_EMAIL?.trim() || null,
    site: process.env.PUBLIC_BASE_URL?.trim() || null,
    /** date the current version of the documents took effect */
    updated: process.env.LEGAL_UPDATED?.trim() || "29 сентября 2026 г.",
  };
}
