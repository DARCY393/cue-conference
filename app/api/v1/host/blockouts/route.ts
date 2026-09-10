import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireHost } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { getStore, isDemoMode } from "@/lib/store";
import { getSpaceById } from "@/lib/space-service";
import { query } from "@/lib/db";
import type { Blockout } from "@/lib/types";

export async function GET(req: NextRequest) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  const spaceId = req.nextUrl.searchParams.get("spaceId");
  if (!spaceId) return jsonError(400, "bad_request", "spaceId is required");
  const from = req.nextUrl.searchParams.get("from") ?? undefined;
  const to = req.nextUrl.searchParams.get("to") ?? undefined;

  if (isDemoMode()) {
    return jsonOk({ data: getStore().listBlockouts(spaceId, from, to) });
  }
  const params: unknown[] = [spaceId];
  let sql = `SELECT id, space_id, starts_at, ends_at, reason FROM blockouts WHERE space_id = $1`;
  if (from) {
    params.push(from);
    sql += ` AND ends_at > $${params.length}`;
  }
  if (to) {
    params.push(to);
    sql += ` AND starts_at < $${params.length}`;
  }
  const { rows } = await query<{
    id: string;
    space_id: string;
    starts_at: string;
    ends_at: string;
    reason: string | null;
  }>(sql, params);
  const data: Blockout[] = rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    reason: r.reason ?? undefined,
  }));
  return jsonOk({ data });
}

export async function POST(req: NextRequest) {
  const auth = requireHost(req);
  if (!auth.ok) return jsonError(auth.status, auth.error, auth.message);
  let body: { spaceId?: string; startsAt?: string; endsAt?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }
  if (!body.spaceId || !body.startsAt || !body.endsAt) {
    return jsonError(400, "bad_request", "spaceId, startsAt, endsAt required");
  }
  const space = await getSpaceById(body.spaceId);
  if (!space) return jsonError(404, "not_found", "Space not found");
  if (new Date(body.endsAt) <= new Date(body.startsAt)) {
    return jsonError(400, "bad_request", "endsAt must be after startsAt");
  }

  const blockout: Blockout = {
    id: randomUUID(),
    spaceId: body.spaceId,
    startsAt: new Date(body.startsAt).toISOString(),
    endsAt: new Date(body.endsAt).toISOString(),
    reason: body.reason,
  };

  if (isDemoMode()) {
    try {
      getStore().createBlockout(blockout);
    } catch (e) {
      return jsonError(409, "conflict", e instanceof Error ? e.message : "Overlap");
    }
    return jsonOk(blockout, 201);
  }

  try {
    await query(
      `INSERT INTO blockouts (id, space_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4,$5)`,
      [blockout.id, blockout.spaceId, blockout.startsAt, blockout.endsAt, blockout.reason ?? null]
    );
  } catch {
    return jsonError(409, "conflict", "Overlaps another blockout");
  }
  return jsonOk(blockout, 201);
}
