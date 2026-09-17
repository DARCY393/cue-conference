import { listSpaces, listLocationsWithSpaces } from "@/lib/space-service";
import { jsonOk } from "@/lib/http";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const grouped = req.nextUrl.searchParams.get("grouped") === "1";
  if (grouped) {
    const data = await listLocationsWithSpaces();
    return jsonOk({ data });
  }
  const spaces = await listSpaces();
  return jsonOk({ data: spaces });
}
