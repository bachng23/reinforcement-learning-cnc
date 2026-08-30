export default function Loading() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-canvas-fog)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: "3px solid var(--color-stone-border)",
            borderTopColor: "var(--color-chartwell-blue)",
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--color-ash-gray)" }}>Loading…</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
