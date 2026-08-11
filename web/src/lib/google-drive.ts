import { google } from "googleapis";

function getDriveClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  // Prefer the drive.readonly credential (same one the agent uses to download
  // files for SFTP push). GOOGLE_REFRESH_TOKEN only carries the drive.file
  // scope, which sees files this app created but NOT files a person uploaded
  // into the folder through the Drive UI — those stay invisible to Refresh.
  auth.setCredentials({
    refresh_token:
      process.env.GDRIVE_DL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN,
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

export interface DriveFolder {
  id: string;
  name: string;
  files: DriveFile[];
  csvFolder?: { id: string; files: DriveFile[] };
}

export async function listSubfoldersWithFiles(parentFolderId: string): Promise<DriveFolder[]> {
  const drive = getDriveClient();

  // List main upload subfolders
  const folderRes = await drive.files.list({
    q: `'${parentFolderId}' in parents and trashed=false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: "files(id,name)",
    orderBy: "name",
  });

  const subfolders = folderRes.data.files ?? [];

  // For each subfolder, fetch its files AND look for a nested "CSV" subfolder
  const results = await Promise.all(
    subfolders.map(async (folder) => {
      const folderId = folder.id ?? "";

      const [mainFiles, csvFolderRes] = await Promise.all([
        listFilesInFolder(folderId),
        drive.files.list({
          q: `'${folderId}' in parents and trashed=false and mimeType = 'application/vnd.google-apps.folder' and name = 'CSV'`,
          fields: "files(id,name)",
        }),
      ]);

      const csvMeta = csvFolderRes.data.files?.[0];
      const csvFolder = csvMeta
        ? { id: csvMeta.id ?? "", files: await listFilesInFolder(csvMeta.id ?? "") }
        : undefined;

      return {
        id: folderId,
        name: folder.name ?? "",
        files: mainFiles,
        csvFolder,
      };
    })
  );

  return results;
}
