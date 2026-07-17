"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { format, parseISO } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  size: string;
  modifiedTime: string;
  webViewLink: string;
  webContentLink: string;
  mimeType: string;
}

type SftpState = "idle" | "pushing" | "success" | "error";

interface SftpAction {
  onPush: () => void;
  state: SftpState;
  error?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  files: DriveFile[];
  csvFolder?: { id: string; files: DriveFile[] };
}

type Tab = "raw" | "forma" | "sftp";
type FormaSubTab = "Demographics Upload File" | "Elections Upload File" | "Contributions Upload File";
type RunStatus = "idle" | "running" | "success" | "error";

interface RunState {
  status: RunStatus;
  message: string;
  jobId?: string;
  startedAt?: string;
}

interface SftpItem {
  name: string;
  type: "directory" | "file";
  size: number;
  modified: number;
}

interface SftpStatus {
  host: string;
  port: number;
  username: string;
  remote_path: string;
  configured: boolean;
  connected: boolean;
  error?: string;
}

interface BrowserModal {
  open: boolean;
  pendingFile: DriveFile | null;
  path: string;
  history: string[];
  items: SftpItem[];
  loading: boolean;
  error: string | null;
  pushing: boolean;
  pushError: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: string) {
  const b = parseInt(bytes || "0");
  if (b === 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBytesNum(bytes: number) {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  try { return format(parseISO(iso), "MMM d, yyyy · h:mm a"); }
  catch { return iso; }
}

// ── Small components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: RunStatus }) {
  const colors: Record<RunStatus, string> = {
    idle: "bg-gray-300",
    running: "bg-yellow-400 animate-pulse",
    success: "bg-green-400",
    error: "bg-red-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
}

function FileTable({
  files,
  loading,
  sftpActions,
}: {
  files: DriveFile[];
  loading: boolean;
  sftpActions?: Record<string, SftpAction>;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <svg className="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm font-medium">No files found</p>
        <p className="text-xs mt-1">Run the agent to generate reports</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">File Name</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Modified</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Size</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {files.map((file) => (
            <tr key={file.id} className="hover:bg-blue-50/40 transition-colors group">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-800 truncate max-w-xs">{file.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(file.modifiedTime)}</td>
              <td className="px-4 py-3 text-gray-500">{formatBytes(file.size)}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  {sftpActions?.[file.id] && (() => {
                    const sftp = sftpActions[file.id];
                    return (
                      <button
                        onClick={sftp.onPush}
                        disabled={sftp.state === "pushing" || sftp.state === "success"}
                        title={sftp.state === "error" && sftp.error ? sftp.error : undefined}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                          sftp.state === "success"
                            ? "text-green-700 bg-green-50 cursor-default"
                            : sftp.state === "error"
                            ? "text-red-600 bg-red-50 hover:bg-red-100 cursor-pointer"
                            : sftp.state === "pushing"
                            ? "text-gray-400 bg-gray-100 cursor-not-allowed"
                            : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 cursor-pointer"
                        }`}
                      >
                        {sftp.state === "pushing" ? (
                          <>
                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            Pushing…
                          </>
                        ) : sftp.state === "success" ? (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            Sent
                          </>
                        ) : sftp.state === "error" ? (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            </svg>
                            Retry SFTP
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                            Push to SFTP
                          </>
                        )}
                      </button>
                    );
                  })()}
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={file.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Open
                    </a>
                    <a
                      href={file.webContentLink}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </a>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SFTP Browser Modal ─────────────────────────────────────────────────────────

function SftpBrowserModal({
  browser,
  sftpStatus,
  onClose,
  onNavigate,
  onBack,
  onPush,
}: {
  browser: BrowserModal;
  sftpStatus: SftpStatus | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onBack: () => void;
  onPush: () => void;
}) {
  if (!browser.open) return null;

  // Build breadcrumb segments
  const segments = browser.path.split("/").filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">
                {sftpStatus?.host || "SFTP Server"}
              </div>
              {sftpStatus?.username && (
                <div className="text-xs text-gray-400">{sftpStatus.username}</div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar — back + breadcrumb */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-white">
          <button
            onClick={onBack}
            disabled={browser.history.length === 0}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default transition-colors"
            title="Back"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-0.5 text-xs text-gray-500 flex-1 min-w-0 overflow-x-auto">
            <button
              onClick={() => onNavigate("/")}
              className="hover:text-blue-600 font-medium px-1 py-0.5 rounded hover:bg-blue-50 transition-colors flex-shrink-0"
            >
              /
            </button>
            {segments.map((seg, i) => {
              const segPath = "/" + segments.slice(0, i + 1).join("/");
              const isLast = i === segments.length - 1;
              return (
                <span key={segPath} className="flex items-center gap-0.5 flex-shrink-0">
                  <span className="text-gray-300">/</span>
                  <button
                    onClick={() => !isLast && onNavigate(segPath)}
                    className={`px-1 py-0.5 rounded transition-colors ${
                      isLast
                        ? "text-gray-800 font-semibold cursor-default"
                        : "hover:text-blue-600 hover:bg-blue-50"
                    }`}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto min-h-0" style={{ height: "320px", maxHeight: "320px" }}>
          {browser.loading ? (
            <div className="space-y-1 p-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : browser.error ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">Browse failed</p>
              <p className="text-xs text-red-500 mb-4 break-all">{browser.error}</p>
              <button
                onClick={() => onNavigate(browser.path)}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          ) : browser.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400">
              <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm font-medium">Empty folder</p>
            </div>
          ) : (
            <div className="py-1">
              {browser.items.map((item) => {
                const isDir = item.type === "directory";
                const itemPath = `${browser.path.replace(/\/$/, "")}/${item.name}`;
                return (
                  <button
                    key={item.name}
                    onClick={() => isDir ? onNavigate(itemPath) : undefined}
                    disabled={!isDir}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
                      isDir
                        ? "hover:bg-blue-50 cursor-pointer"
                        : "cursor-default opacity-70"
                    }`}
                  >
                    {isDir ? (
                      <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <span className={`flex-1 truncate font-medium ${isDir ? "text-gray-800" : "text-gray-600"}`}>
                      {item.name}
                    </span>
                    {!isDir && (
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatBytesNum(item.size)}</span>
                    )}
                    {isDir && (
                      <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 bg-gray-50/80 px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-gray-500 truncate">
              Pushing: <span className="font-semibold text-gray-700">{browser.pendingFile?.name ?? "—"}</span>
            </span>
            <span className="text-xs text-gray-400 truncate mt-0.5">
              Destination: <span className="font-mono">{browser.path || "/"}</span>
            </span>
            {browser.pushError && (
              <span className="text-xs text-red-500 mt-1 truncate">{browser.pushError}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onPush}
              disabled={browser.pushing || browser.loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-lg transition-colors shadow-sm"
            >
              {browser.pushing ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Pushing…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Push here
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("raw");
  const [formaSubTab, setFormaSubTab] = useState<FormaSubTab>("Demographics Upload File");
  const [files, setFiles] = useState<{ raw: DriveFile[] }>({ raw: [] });
  const [formaFolders, setFormaFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState<{ raw: boolean; forma: boolean }>({ raw: true, forma: true });
  const [formaError, setFormaError] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle", message: "" });
  const [sftpStates, setSftpStates] = useState<Record<string, { state: SftpState; error?: string }>>({});
  const [formaRefreshing, setFormaRefreshing] = useState(false);

  // SFTP Settings state
  const [sftpStatus, setSftpStatus] = useState<SftpStatus | null>(null);
  const [sftpStatusLoading, setSftpStatusLoading] = useState(false);
  const [sftpForm, setSftpForm] = useState({
    host: "", port: "22", username: "", password: "", remote_path: "/",
  });
  const [sftpSaving, setSftpSaving] = useState(false);
  const [sftpSaveMsg, setSftpSaveMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  // SFTP file browser modal
  const [browser, setBrowser] = useState<BrowserModal>({
    open: false, pendingFile: null, path: "/", history: [],
    items: [], loading: false, error: null, pushing: false, pushError: null,
  });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const fetchFiles = useCallback(async (tab: "raw" | "forma") => {
    setLoading((l) => ({ ...l, [tab]: true }));
    if (tab === "forma") setFormaError(null);
    try {
      const url = `/api/drive?folder=${tab === "forma" ? "forma" : "raw"}&_t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
      }
      const data = await res.json();
      if (tab === "forma") {
        const FOLDER_ORDER: Record<string, number> = {
          "Demographics Upload File": 0,
          "Elections Upload File":    1,
          "Contributions Upload File": 2,
        };
        const sorted = (data.folders ?? []).slice().sort(
          (a: DriveFolder, b: DriveFolder) =>
            (FOLDER_ORDER[a.name] ?? 99) - (FOLDER_ORDER[b.name] ?? 99)
        );
        setFormaFolders(sorted);
      } else {
        setFiles((f) => ({ ...f, raw: data.files ?? [] }));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      if (tab === "forma") { setFormaFolders([]); setFormaError(msg); }
      else setFiles((f) => ({ ...f, raw: [] }));
    } finally {
      setLoading((l) => ({ ...l, [tab]: false }));
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchFiles("raw");
      fetchFiles("forma");
    }
  }, [status, fetchFiles]);

  // Poll status while running
  useEffect(() => {
    if (run.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/status${run.jobId ? `?job_id=${run.jobId}` : ""}`);
        const data = await res.json();
        if (data.status === "completed") {
          setRun({ status: "success", message: "Reports downloaded and uploaded to Drive successfully.", jobId: run.jobId });
          fetchFiles("raw");
          fetchFiles("forma");
        } else if (data.status === "failed") {
          setRun({ status: "error", message: data.error ?? "Agent run failed.", jobId: run.jobId });
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [run, fetchFiles]);

  // ── SFTP helpers ──────────────────────────────────────────────────────────

  const fetchSftpStatus = useCallback(async () => {
    setSftpStatusLoading(true);
    try {
      const res = await fetch("/api/sftp/status");
      const data = await res.json();
      setSftpStatus(data);
      if (data.host) {
        setSftpForm((f) => ({
          ...f,
          host: data.host,
          port: String(data.port),
          username: data.username,
          remote_path: data.remote_path,
        }));
      }
    } catch {
      setSftpStatus(null);
    } finally {
      setSftpStatusLoading(false);
    }
  }, []);

  const browsePath = useCallback(async (path: string, addHistory = true) => {
    setBrowser((b) => ({ ...b, loading: true, error: null }));
    try {
      const res = await fetch(`/api/sftp/browse?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.detail ?? "Browse failed");
      setBrowser((b) => ({
        ...b,
        path,
        items: data.items,
        history: addHistory && b.path !== path ? [...b.history, b.path] : b.history,
        loading: false,
      }));
    } catch (e: unknown) {
      setBrowser((b) => ({
        ...b,
        loading: false,
        error: e instanceof Error ? e.message : "Failed",
      }));
    }
  }, []);

  const handleSftpPush = useCallback(
    (file: DriveFile) => {
      setBrowser({
        open: true, pendingFile: file, path: "/", history: [],
        items: [], loading: true, error: null, pushing: false, pushError: null,
      });
      browsePath("/", false);
    },
    [browsePath],
  );

  const handlePushToPath = async () => {
    if (!browser.pendingFile) return;
    setBrowser((b) => ({ ...b, pushing: true, pushError: null }));
    try {
      const res = await fetch("/api/sftp/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: browser.pendingFile.id,
          fileName: browser.pendingFile.name,
          mimeType: browser.pendingFile.mimeType,
          remoteDir: browser.path,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Push failed");
      const pushedFileId = browser.pendingFile.id;
      setBrowser((b) => ({ ...b, pushing: false, open: false }));
      setSftpStates((s) => ({ ...s, [pushedFileId]: { state: "success" } }));
      setTimeout(
        () => setSftpStates((s) => ({ ...s, [pushedFileId]: { state: "idle" } })),
        4000,
      );
    } catch (e: unknown) {
      setBrowser((b) => ({
        ...b,
        pushing: false,
        pushError: e instanceof Error ? e.message : "Push failed",
      }));
    }
  };

  const handleSaveSftpConfig = async () => {
    setSftpSaving(true);
    setSftpSaveMsg(null);
    try {
      const res = await fetch("/api/sftp/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: sftpForm.host,
          port: parseInt(sftpForm.port, 10) || 22,
          username: sftpForm.username,
          password: sftpForm.password,
          remote_path: sftpForm.remote_path,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSftpSaveMsg({ ok: true, msg: "Settings saved." });
        setSftpStatus(null); // will refresh on next fetch
      } else {
        setSftpSaveMsg({ ok: false, msg: data.error ?? "Save failed." });
      }
    } catch {
      setSftpSaveMsg({ ok: false, msg: "Could not reach agent." });
    } finally {
      setSftpSaving(false);
    }
  };

  const handleTestConnection = async () => {
    await handleSaveSftpConfig();
    fetchSftpStatus();
  };

  // Load SFTP status when tab becomes active
  useEffect(() => {
    if (activeTab === "sftp" && !sftpStatus) fetchSftpStatus();
  }, [activeTab, sftpStatus, fetchSftpStatus]);

  const refreshForma = useCallback(async () => {
    setFormaRefreshing(true);
    await fetchFiles("forma");
    setFormaRefreshing(false);
  }, [fetchFiles]);

  const handleRunNow = async () => {
    setRun({ status: "running", message: "Agent is running. This takes ~3 minutes…", startedAt: new Date().toISOString() });
    try {
      const res = await fetch("/api/agent/trigger", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRun({ status: "error", message: data.error ?? "Failed to start agent." });
      } else {
        setRun((r) => ({ ...r, jobId: data.job_id, message: "Agent is running. This takes ~3 minutes…" }));
      }
    } catch {
      setRun({ status: "error", message: "Could not reach the agent service." });
    }
  };

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const formaFileCount = formaFolders.reduce((sum, f) => sum + f.files.length, 0);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "raw",   label: "Raw EN Reports",      count: files.raw.length },
    { id: "forma", label: "Forma Upload Files",  count: formaFileCount },
    { id: "sftp",  label: "SFTP Settings",       count: -1 },
  ];

  const nextRunLabel = (() => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = (1 - day + 7) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    const nextMondayDate = nextMonday.getDate();
    const isFirstMonday = nextMondayDate >= 1 && nextMondayDate <= 7;
    const isThirdMonday = nextMondayDate >= 15 && nextMondayDate <= 21;
    if (isFirstMonday || isThirdMonday) {
      return `${format(nextMonday, "MMM d")} at 9:00 AM`;
    }
    nextMonday.setDate(nextMonday.getDate() + 7);
    return `${format(nextMonday, "MMM d")} at 9:00 AM`;
  })();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-white" stroke="currentColor" strokeWidth={2.5}>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-bold text-gray-900">EN Reports</span>
              <span className="ml-2 text-xs text-gray-400">Redesign Health</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {session?.user?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="" className="w-7 h-7 rounded-full ring-2 ring-gray-100" />
            )}
            <span className="text-sm text-gray-600 hidden sm:block">{session?.user?.name}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 w-full flex-1">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reports Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Next scheduled run: <span className="font-medium text-gray-700">{nextRunLabel}</span>
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={handleRunNow}
              disabled={run.status === "running"}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-xl shadow-sm shadow-blue-200 transition-all duration-200"
            >
              {run.status === "running" ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run Now
                </>
              )}
            </button>

            {run.status !== "idle" && (
              <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
                run.status === "running" ? "bg-yellow-50 text-yellow-700" :
                run.status === "success" ? "bg-green-50 text-green-700" :
                "bg-red-50 text-red-700"
              }`}>
                <StatusDot status={run.status} />
                {run.message}
              </div>
            )}
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Raw Reports",  value: files.raw.length, icon: "📄" },
            { label: "Forma Files",  value: formaFileCount,   icon: "📤" },
            { label: "Schedule",     value: "Bi-monthly",     icon: "📅" },
            { label: "Status",       value: run.status === "running" ? "Running" : "Ready", icon: run.status === "running" ? "⚡" : "✓" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="text-lg mb-1">{s.icon}</div>
              <div className="text-2xl font-bold text-gray-900">{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tab panel */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? "text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.id === "sftp" ? (
                  // Show green dot if connected, nothing otherwise
                  sftpStatus?.connected ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" title="Connected" />
                  ) : null
                ) : (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    activeTab === tab.id ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                  }`}>
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center pr-4">
              <button
                onClick={() => {
                  if (activeTab === "sftp") fetchSftpStatus();
                  else if (activeTab === "forma") refreshForma();
                  else fetchFiles("raw");
                }}
                disabled={formaRefreshing && activeTab === "forma"}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-40"
                title="Refresh"
              >
                <svg className={`w-4 h-4 ${formaRefreshing && activeTab === "forma" ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Raw tab */}
          {activeTab === "raw" && (
            <FileTable files={files.raw} loading={loading.raw} />
          )}

          {/* Forma tab */}
          {activeTab === "forma" && (() => {
            const FORMA_SUBTABS: FormaSubTab[] = [
              "Demographics Upload File",
              "Elections Upload File",
              "Contributions Upload File",
            ];
            const activeFolder = formaFolders.find((f) => f.name === formaSubTab);
            return (
              <>
                <div className="flex border-b border-gray-100 bg-gray-50/60 px-2 pt-2 gap-1">
                  {FORMA_SUBTABS.map((sub, idx) => {
                    const folder = formaFolders.find((f) => f.name === sub);
                    const count = folder?.files.length ?? 0;
                    const isActive = formaSubTab === sub;
                    return (
                      <button
                        key={sub}
                        onClick={() => setFormaSubTab(sub)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all relative ${
                          isActive
                            ? "bg-white text-blue-600 border border-b-white border-gray-100 shadow-sm -mb-px z-10"
                            : "text-gray-500 hover:text-gray-700 hover:bg-white/60"
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold flex-shrink-0 ${
                          isActive ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
                        }`}>
                          {idx + 1}
                        </span>
                        <span className="hidden sm:inline">{sub.replace(" Upload File", "")}</span>
                        <span className="sm:hidden">{["Demo", "Elections", "Contributions"][idx]}</span>
                        {count > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                            isActive ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                          }`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {formaError && (
                  <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01" />
                    </svg>
                    Drive error: {formaError}
                  </div>
                )}

                {loading.forma ? (
                  <div className="space-y-2 p-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : !activeFolder ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <svg className="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm font-medium">No files yet</p>
                    <p className="text-xs mt-1">Run the agent to generate upload files</p>
                  </div>
                ) : (
                  <div>
                    {activeFolder.files.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border-b border-green-100">
                          <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-xs font-semibold text-green-700">Excel Files</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 font-semibold">{activeFolder.files.length}</span>
                        </div>
                        <FileTable files={activeFolder.files} loading={false} />
                      </div>
                    )}

                    {activeFolder.csvFolder ? (
                      <div>
                        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 border-t border-t-gray-100">
                          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-xs font-semibold text-blue-700">CSV Files</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-semibold">{activeFolder.csvFolder.files.length}</span>
                          <span className="text-[10px] text-blue-400 ml-1">— use these for Forma upload</span>
                          <button
                            onClick={refreshForma}
                            disabled={formaRefreshing}
                            title="Refresh CSV files from Google Drive"
                            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-blue-600 bg-white border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors"
                          >
                            <svg className={`w-3 h-3 ${formaRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {formaRefreshing ? "Refreshing…" : "Refresh"}
                          </button>
                        </div>
                        <FileTable
                          files={activeFolder.csvFolder.files}
                          loading={false}
                          sftpActions={Object.fromEntries(
                            activeFolder.csvFolder.files.map((f) => [
                              f.id,
                              {
                                onPush: () => handleSftpPush(f),
                                state: sftpStates[f.id]?.state ?? "idle",
                                error: sftpStates[f.id]?.error,
                              },
                            ])
                          )}
                        />
                      </div>
                    ) : activeFolder.files.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                        <p className="text-sm font-medium">No files yet</p>
                        <p className="text-xs mt-1">Run the agent to generate upload files</p>
                        <button
                          onClick={refreshForma}
                          disabled={formaRefreshing}
                          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-xl transition-colors border border-blue-100"
                        >
                          <svg className={`w-3.5 h-3.5 ${formaRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {formaRefreshing ? "Refreshing…" : "Refresh from Drive"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            );
          })()}

          {/* SFTP Settings tab */}
          {activeTab === "sftp" && (
            <div className="p-6">
              {/* Connection status banner */}
              {sftpStatusLoading ? (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 border border-gray-100 mb-6 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-200 rounded w-32" />
                    <div className="h-2.5 bg-gray-200 rounded w-48" />
                  </div>
                </div>
              ) : sftpStatus ? (
                <div className={`flex items-start gap-3 p-4 rounded-xl border mb-6 ${
                  sftpStatus.connected
                    ? "bg-emerald-50 border-emerald-100"
                    : sftpStatus.configured
                    ? "bg-red-50 border-red-100"
                    : "bg-gray-50 border-gray-100"
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    sftpStatus.connected ? "bg-emerald-100" : sftpStatus.configured ? "bg-red-100" : "bg-gray-100"
                  }`}>
                    {sftpStatus.connected ? (
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : sftpStatus.configured ? (
                      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${
                      sftpStatus.connected ? "text-emerald-700" : sftpStatus.configured ? "text-red-700" : "text-gray-600"
                    }`}>
                      {sftpStatus.connected
                        ? "Connected"
                        : sftpStatus.configured
                        ? "Connection failed"
                        : "Not configured"}
                    </p>
                    {sftpStatus.connected ? (
                      <p className="text-xs text-emerald-600 mt-0.5">
                        {sftpStatus.username}@{sftpStatus.host}:{sftpStatus.port} — default path: {sftpStatus.remote_path}
                      </p>
                    ) : sftpStatus.error ? (
                      <p className="text-xs text-red-500 mt-0.5 break-all">{sftpStatus.error}</p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-0.5">Fill in the form below to connect an SFTP server.</p>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Config form */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Host */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Host</label>
                  <input
                    type="text"
                    value={sftpForm.host}
                    onChange={(e) => setSftpForm((f) => ({ ...f, host: e.target.value }))}
                    placeholder="sftp.example.com"
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow placeholder-gray-300"
                  />
                </div>

                {/* Port */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Port</label>
                  <input
                    type="number"
                    value={sftpForm.port}
                    onChange={(e) => setSftpForm((f) => ({ ...f, port: e.target.value }))}
                    placeholder="22"
                    min={1}
                    max={65535}
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow placeholder-gray-300"
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Username</label>
                  <input
                    type="text"
                    value={sftpForm.username}
                    onChange={(e) => setSftpForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="username"
                    autoComplete="off"
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow placeholder-gray-300"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Password
                    <span className="ml-1.5 font-normal text-gray-400">(leave blank to keep existing)</span>
                  </label>
                  <input
                    type="password"
                    value={sftpForm.password}
                    onChange={(e) => setSftpForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow placeholder-gray-300"
                  />
                </div>

                {/* Remote path — spans full width */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Default Remote Path</label>
                  <input
                    type="text"
                    value={sftpForm.remote_path}
                    onChange={(e) => setSftpForm((f) => ({ ...f, remote_path: e.target.value }))}
                    placeholder="/uploads"
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow font-mono placeholder-gray-300"
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    This path is used when pushing files without selecting a specific directory via the browser.
                  </p>
                </div>
              </div>

              {/* Feedback message */}
              {sftpSaveMsg && (
                <div className={`mt-4 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                  sftpSaveMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                }`}>
                  {sftpSaveMsg.ok ? (
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01" />
                    </svg>
                  )}
                  {sftpSaveMsg.msg}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={handleSaveSftpConfig}
                  disabled={sftpSaving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-xl shadow-sm shadow-blue-100 transition-colors"
                >
                  {sftpSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      Save Settings
                    </>
                  )}
                </button>

                <button
                  onClick={handleTestConnection}
                  disabled={sftpSaving || sftpStatusLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 rounded-xl transition-colors border border-emerald-100"
                >
                  {sftpStatusLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      Testing…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                      </svg>
                      Test Connection
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Drive links */}
        <div className="mt-4 flex gap-4 text-xs text-gray-400">
          <a
            href={`https://drive.google.com/drive/folders/${process.env.NEXT_PUBLIC_GDRIVE_RAW_FOLDER_ID || "1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL"}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-500 transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Raw Reports in Drive
          </a>
          <a
            href={`https://drive.google.com/drive/folders/${process.env.NEXT_PUBLIC_GDRIVE_FORMA_FOLDER_ID || "1tUzez4CpPUV9oks8XUY-HzBen54Q0AYs"}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-500 transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Forma Upload Files in Drive
          </a>
        </div>
      </main>

      {/* SFTP Browser Modal — rendered outside main scroll container */}
      <SftpBrowserModal
        browser={browser}
        sftpStatus={sftpStatus}
        onClose={() => setBrowser((b) => ({ ...b, open: false }))}
        onNavigate={(path) => browsePath(path)}
        onBack={() => {
          if (browser.history.length === 0) return;
          const prev = browser.history[browser.history.length - 1];
          setBrowser((b) => ({ ...b, history: b.history.slice(0, -1) }));
          browsePath(prev, false);
        }}
        onPush={handlePushToPath}
      />
    </div>
  );
}
