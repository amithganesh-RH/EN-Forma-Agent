import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body     = await req.json();
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8080";
  const secret   = process.env.AGENT_WEBHOOK_SECRET ?? "";

  try {
    const res = await fetch(`${agentUrl}/sftp/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Could not reach agent" }, { status: 502 });
  }
}
