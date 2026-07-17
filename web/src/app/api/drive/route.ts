import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listFilesInFolder, listSubfoldersWithFiles } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const folder = req.nextUrl.searchParams.get("folder");

  try {
    if (folder === "forma") {
      const folderId = process.env.GDRIVE_RAW_FOLDER_ID!;
      const folders = await listSubfoldersWithFiles(folderId);
      console.log("[drive/forma] folders returned:", JSON.stringify(
        folders.map(f => ({
          name: f.name,
          files: f.files.length,
          csvFiles: f.csvFolder?.files.length ?? "no csv folder",
        }))
      ));
      return NextResponse.json({ folders });
    } else {
      const folderId = process.env.GDRIVE_RAW_FOLDER_ID!;
      const files = await listFilesInFolder(folderId);
      return NextResponse.json({ files });
    }
  } catch (err) {
    console.error("Drive API error:", err);
    return NextResponse.json({ error: "Failed to fetch files" }, { status: 500 });
  }
}
