import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", service: "en-reports-web" }, { status: 200 });
}
