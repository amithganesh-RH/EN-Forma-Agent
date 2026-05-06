"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { format, parseISO } from "date-fns";

interface DriveFile {
  id: string;
  name: string;
  size: string;
  modifiedTime: string;
  webViewLink: string;
  webContentLink: string;
}

type Tab = "raw" | "forma";
type RunStatus = "idle" | "running" | "success" | "error";

interface RunState {
  status: RunStatus;
  message: string;
  jobId?: string;
  startedAt?: string;
}

function formatBytes(bytes: string) {
  const b = parseInt(bytes || "0");
  if (b === 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  try { return format(parseISO(iso), "MMM d, yyyy · h:mm a"); }
  catch { return iso; }
}

function StatusDot({ status }: { status: RunStatus }) {
  const colors: Record<RunStatus, string> = {
    idle: "bg-gray-300",
    running: "bg-yellow-400 animate-pulse",
    success: "bg-green-400",
    error: "bg-red-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
}

function FileTable({ files, loading }: { files: DriveFile[]; loading: boolean }) {
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
                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("raw");
  const [files, setFiles] = useState<{ raw: DriveFile[]; forma: DriveFile[] }>({ raw: [], forma: [] });
  const [loading, setLoading] = useState<{ raw: boolean; forma: boolean }>({ raw: true, forma: true });
  const [run, setRun] = useState<RunState>({ status: "idle", message: "" });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const fetchFiles = useCallback(async (tab: Tab) => {
    setLoading((l) => ({ ...l, [tab]: true }));
    try {
      const res = await fetch(`/api/drive?folder=${tab === "forma" ? "forma" : "raw"}`);
      const data = await res.json();
      setFiles((f) => ({ ...f, [tab]: data.files ?? [] }));
    } catch {
      setFiles((f) => ({ ...f, [tab]: [] }));
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

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "raw", label: "Raw EN Reports", count: files.raw.length },
    { id: "forma", label: "Forma Upload Files", count: files.forma.length },
  ];

  const nextRunLabel = (() => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon
    const date = now.getDate();
    // Find next 1st Monday (1-7) or 3rd Monday (15-21)
    const daysUntilMonday = (1 - day + 7) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    const nextMondayDate = nextMonday.getDate();
    const isFirstMonday = nextMondayDate >= 1 && nextMondayDate <= 7;
    const isThirdMonday = nextMondayDate >= 15 && nextMondayDate <= 21;
    if (isFirstMonday || isThirdMonday) {
      return `${format(nextMonday, "MMM d")} at 9:00 AM`;
    }
    // Find the Monday after that
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
        {/* Top bar: title + Run Now */}
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
            { label: "Raw Reports", value: files.raw.length, icon: "📄" },
            { label: "Forma Files", value: files.forma.length, icon: "📤" },
            { label: "Schedule", value: "Bi-monthly", icon: "📅" },
            { label: "Status", value: run.status === "running" ? "Running" : "Ready", icon: run.status === "running" ? "⚡" : "✓" },
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
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.id ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                }`}>
                  {tab.count}
                </span>
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center pr-4">
              <button
                onClick={() => fetchFiles(activeTab)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* File list */}
          {activeTab === "raw" && (
            <FileTable files={files.raw} loading={loading.raw} />
          )}
          {activeTab === "forma" && (
            <FileTable files={files.forma} loading={loading.forma} />
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
    </div>
  );
}
