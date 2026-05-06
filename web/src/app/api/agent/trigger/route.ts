import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agentUrl = process.env.AGENT_SERVICE_URL;
  const secret = process.env.AGENT_WEBHOOK_SECRET;

  if (!agentUrl) {
    return NextResponse.json({ error: "Agent service not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${agentUrl}/trigger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret ?? "",
      },
      body: JSON.stringify({
        triggered_by: session.user?.email,
        triggered_at: new Date().toISOString(),
      }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("Agent trigger error:", err);
    return NextResponse.json({ error: "Failed to reach agent service" }, { status: 502 });
  }
}
