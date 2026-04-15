import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const auditLog: Map<string, object> = new Map();

export async function POST(req: NextRequest) {
  let body: { dealId: string } & object;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const logHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const record = { ...body, logHash };
  auditLog.set(body.dealId, record);
  return NextResponse.json({ ok: true, dealId: body.dealId, logHash });
}

export async function GET(req: NextRequest) {
  const dealId = new URL(req.url).searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ ok: true, records: Array.from(auditLog.values()).reverse() });
  const record = auditLog.get(dealId);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record });
}
