import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = req.nextUrl.searchParams.get("job_id");
  const agentUrl = process.env.AGENT_SERVICE_URL;

  if (!agentUrl) {
    return NextResponse.json({ error: "Agent service not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${agentUrl}/status${jobId ? `/${jobId}` : ""}`, {
      headers: { "X-Webhook-Secret": process.env.AGENT_WEBHOOK_SECRET ?? "" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to reach agent service" }, { status: 502 });
  }
}
