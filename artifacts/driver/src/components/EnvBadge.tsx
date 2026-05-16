import { appEnv } from "@/services/api/baseUrl";

export function EnvBadge() {
  if (appEnv === "production") return null;
  const label = appEnv.toUpperCase();
  return (
    <div
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top, 0px)",
        right: 8,
        zIndex: 9999,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        color: "#0B1220",
        background: appEnv === "staging" ? "#F59E0B" : "#22D3EE",
        borderRadius: 4,
        pointerEvents: "none",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }}
      aria-hidden="true"
    >
      {label}
    </div>
  );
}
