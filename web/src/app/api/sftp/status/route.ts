import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8080";
  const secret   = process.env.AGENT_WEBHOOK_SECRET ?? "";

  try {
    const res = await fetch(`${agentUrl}/sftp/status`, {
      headers: { "X-Webhook-Secret": secret },
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Could not reach agent" }, { status: 502 });
  }
}
