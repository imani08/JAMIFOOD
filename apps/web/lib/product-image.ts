// Images pass through the same-origin Next rewrite, including session cookies.
// Keep stored paths portable: never persist a host name in PostgreSQL.
export function productImageUrl(value: string | null | undefined): string | null {
  return value && /^\/api\/v1\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(value) ? value : null;
}
