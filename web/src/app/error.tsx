"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <h2 style={{ color: "#1e40af", marginBottom: "8px" }}>Something went wrong</h2>
      <button onClick={reset} style={{ padding: "8px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: "8px", cursor: "pointer" }}>
        Try again
      </button>
    </div>
  );
}
