function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

export function getBackendApiBaseUrl() {
  return normalizeBaseUrl(
    process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:3001"
  );
}

export function buildBackendApiUrl(pathname, searchParams) {
  const url = new URL(pathname, getBackendApiBaseUrl());

  for (const [key, value] of searchParams.entries()) {
    url.searchParams.set(key, value);
  }

  return url;
}
