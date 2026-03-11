import { NextResponse } from "next/server";
import { buildBackendApiUrl } from "../../../lib/backend-api.js";

export async function GET(request) {
  const upstreamUrl = buildBackendApiUrl("/api/history", request.nextUrl.searchParams);
  const response = await fetch(upstreamUrl, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8"
    }
  });
}
