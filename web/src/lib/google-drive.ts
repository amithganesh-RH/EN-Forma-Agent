import { google } from "googleapis";

function getDriveClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  return google.drive({ version: "v3", auth });
}

export interface DriveFile {
  id: string;
  name: string;
  size: string;
  modifiedTime: string;
  webViewLink: string;
  webContentLink: string;
  mimeType: string;
}

export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id,name,size,modifiedTime,webViewLink,webContentLink,mimeType)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    size: f.size ?? "0",
    modifiedTime: f.modifiedTime ?? "",
    webViewLink: f.webViewLink ?? "",
    webContentLink: f.webContentLink ?? "",
    mimeType: f.mimeType ?? "",
  }));
}
