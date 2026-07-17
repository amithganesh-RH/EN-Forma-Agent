import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId, fileName, mimeType, remoteDir } = await req.json();
  if (!fileId || !fileName) {
    return NextResponse.json({ error: "fileId and fileName are required" }, { status: 400 });
  }

  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8080";
  const secret   = process.env.AGENT_WEBHOOK_SECRET ?? "";

  try {
    const res = await fetch(`${agentUrl}/sftp/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify({
        file_id: fileId,
        file_name: fileName,
        mime_type: mimeType,
        remote_dir: remoteDir ?? null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail ?? "SFTP push failed" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not reach agent service" }, { status: 502 });
  }
}
