import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, getIsAdmin } from "../services/supabase";

function clsx(...xs) {
  return xs.filter(Boolean).join(" ");
}

function nowTs() {
  return new Date().toLocaleTimeString();
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const STORE_KEY = "lm_admin_panel_web_v1";

function loadUiState() {
  const raw = typeof window !== "undefined" ? localStorage.getItem(STORE_KEY) : null;
  const data = safeJsonParse(raw);
  return {
    minimized: !!data?.minimized,
    tab: data?.tab || "actions",
    pos: data?.pos || { right: 16, bottom: 16 },
  };
}

function saveUiState(state) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

async function audit(action, payload, result) {
  // Writes are admin-only via RLS.
  // Keep it minimal and safe.
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess?.session?.user?.id || null;

  const row = {
    admin_user_id: userId,
    action: String(action || "unknown"),
    target_user_id: null,
    context: {
      payload: payload || null,
      result: result || null,
    },
  };

  return supabase.from("lifemaxing_admin_audit").insert([row]);
}

async function confirmDanger(promptText) {
  const typed = window.prompt(promptText);
  return typed && typed.trim().toUpperCase() === "CONFIRM";
}

export default function AdminPanelWeb({ onClose, onOpenCommandPalette }) {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const didInit = useRef(false);

  const ui0 = useMemo(() => loadUiState(), []);
  const [minimized, setMinimized] = useState(ui0.minimized);
  const [tab, setTab] = useState(ui0.tab);
  const [pos, setPos] = useState(ui0.pos);

  const [logLines, setLogLines] = useState([]);
  const [cmd, setCmd] = useState("");

  const rootRef = useRef(null);
  const headerRef = useRef(null);

  function log(line) {
    setLogLines((prev) =>
      [...prev, `[${nowTs()}] ${line}`].slice(-200)
    );
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      setLoading(true);
      const ok = await getIsAdmin();
      if (!mounted) return;
      setAllowed(ok);
      setLoading(false);
      if (ok && !didInit.current) {
        didInit.current = true;
        log("Admin panel ready.");
      }
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      init();
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    saveUiState({ minimized, tab, pos });
  }, [minimized, tab, pos]);

  // ESC closes (minimize) safely
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setMinimized(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dragging (pointer events)
  useEffect(() => {
    const header = headerRef.current;
    const root = rootRef.current;
    if (!header || !root) return;

    let dragging = false;
    let startX = 0,
      startY = 0;
    let startRight = 0,
      startBottom = 0;

    function onDown(e) {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startRight = pos.right;
      startBottom = pos.bottom;
      header.setPointerCapture?.(e.pointerId);
    }

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const nextRight = Math.max(8, startRight - dx);
      const nextBottom = Math.max(8, startBottom - dy);
      setPos({
        right: Math.round(nextRight),
        bottom: Math.round(nextBottom),
      });
    }

    function onUp() {
      dragging = false;
    }

    header.addEventListener("pointerdown", onDown);
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);

    return () => {
      header.removeEventListener("pointerdown", onDown);
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
    };
  }, [pos]);

  const style = {
    position: "fixed",
    right: pos.right,
    bottom: pos.bottom,
    width: minimized ? 240 : 380,
    maxWidth: "calc(100vw - 32px)",
    background: "rgba(20,20,22,0.96)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
    zIndex: 2147483647,
    overflow: "hidden",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji"',
  };

  const btn = {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    padding: "6px 9px",
    borderRadius: 10,
    fontSize: 12,
    cursor: "pointer",
  };

  if (loading) return null;
  if (!allowed) return null;

  async function runAction(name, fn, payload) {
    log(`→ ${name}`);
    try {
      const result = await fn();
      await audit(name, payload || null, { ok: true, result });
      log(`✓ ${name}`);
      return result;
    } catch (e) {
      await audit(name, payload || null, {
        ok: false,
        error: String(e?.message || e),
      });
      log(`✕ ${name}: ${String(e?.message || e)}`);
      throw e;
    }
  }

  // -------- ACTIONS (IMPLEMENTED NOW) --------
  async function actionResetMyCloudBackup() {
    const ok = await confirmDanger(
      "Type CONFIRM to delete YOUR cloud backup + summary.\nThis cannot be undone."
    );
    if (!ok) {
      log("Canceled.");
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id;

    if (!userId) throw new Error("No session");

    // Deletes are admin-only by your RLS (support tool).
    await supabase.from("lifemaxing_backups").delete().eq("user_id", userId);

    await supabase.from("lifemaxing_backup_summary").delete().eq("user_id", userId);

    log("Cloud backup removed for current user.");
  }

  async function actionViewMyProfile() {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id;
    if (!userId) throw new Error("No session");

    const res = await supabase
      .from("lifemaxing_user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (res.error) throw res.error;
    log("Profile: " + JSON.stringify(res.data));
    return res.data;
  }

  async function actionInsertSystemEvent(type = "admin_ping") {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id;
    if (!userId) throw new Error("No session");

    const row = {
      user_id: userId,
      type,
      message: "admin panel event",
      context: { note: "admin panel event" },
    };

    const res = await supabase.from("lifemaxing_system_events").insert([row]);

    if (res.error) throw res.error;
    return true;
  }

  // -------- COMMAND ROUTER (CLIENT-SIDE) --------
  async function runCommand(raw) {
    const text = (raw || "").trim();
    if (!text) return;

    log(`> ${text}`);
    const parts = text.split(/\s+/);
    const head = (parts[0] || "").toLowerCase();

    if (head === "help") {
      log("Commands:");
      log("- help");
      log("- ping");
      log("- profile");
      log("- reset_my_backup");
      return;
    }

    if (head === "ping") {
      return runAction(
        "system_event_ping",
        () => actionInsertSystemEvent("admin_ping"),
        { cmd: text }
      );
    }

    if (head === "profile") {
      return runAction("view_profile", () => actionViewMyProfile(), { cmd: text });
    }

    if (head === "reset_my_backup") {
      return runAction("reset_my_cloud_backup", () => actionResetMyCloudBackup(), {
        cmd: text,
      });
    }

    log("Unknown command. Type: help");
  }

  return (
    <div ref={rootRef} style={style} aria-label="Admin Panel" role="dialog">
      <div
        ref={headerRef}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "rgba(255,255,255,0.06)",
          cursor: "grab",
          userSelect: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontWeight: 650,
            fontSize: 13,
          }}
        >
          <span
            title="Admin"
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: "#2ecc71",
              boxShadow: "0 0 0 3px rgba(46,204,113,0.18)",
            }}
          />
          <span>Admin</span>
          <span style={{ fontSize: 11, opacity: 0.75 }}>Supabase</span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={btn} type="button" onClick={() => setMinimized((v) => !v)}>
            {minimized ? "Expand" : "Minimize"}
          </button>
          <button style={btn} type="button" onClick={() => setMinimized(true)}>
            Hide
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div style={{ display: "flex", gap: 6, padding: "10px 12px 0 12px" }}>
            {["actions", "commands", "inspect"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  ...btn,
                  borderRadius: 999,
                  padding: "7px 10px",
                  background: tab === t
                    ? "rgba(255,255,255,0.14)"
                    : "rgba(255,255,255,0.06)",
                }}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div style={{ padding: "10px 12px 12px 12px" }}>
            {tab === "actions" && (
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.92 }}>Quick actions</div>
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                    marginTop: 6,
                    lineHeight: 1.35,
                  }}
                >
                  Safe dev tools. Writes are audited.
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {onOpenCommandPalette ? (
                    <button
                      style={btn}
                      type="button"
                      onClick={() => onOpenCommandPalette()}
                    >
                      Open Command Palette
                    </button>
                  ) : null}
                  <button
                    style={btn}
                    type="button"
                    onClick={() =>
                      runAction("system_event_ping", () => actionInsertSystemEvent("admin_ping"), {})
                    }
                  >
                    Ping Event
                  </button>

                  <button
                    style={btn}
                    type="button"
                    onClick={() => runAction("view_profile", () => actionViewMyProfile(), {})}
                  >
                    View My Profile
                  </button>

                  <button
                    style={btn}
                    type="button"
                    onClick={() =>
                      runAction("reset_my_cloud_backup", () => actionResetMyCloudBackup(), {})
                    }
                  >
                    Reset My Backup
                  </button>
                </div>
              </div>
            )}

            {tab === "commands" && (
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.92 }}>Command line</div>
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                    marginTop: 6,
                    lineHeight: 1.35,
                  }}
                >
                  Type: help
                </div>

                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  placeholder='Try: "help" or "ping"'
                  style={{
                    width: "100%",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.25)",
                    color: "#fff",
                    padding: "9px 10px",
                    fontSize: 12,
                    outline: "none",
                    marginTop: 10,
                  }}
                />

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    style={btn}
                    type="button"
                    onClick={() => {
                      runCommand(cmd);
                      setCmd("");
                    }}
                  >
                    Run
                  </button>
                  <button style={btn} type="button" onClick={() => setLogLines([])}>
                    Clear Log
                  </button>
                </div>
              </div>
            )}

            {tab === "inspect" && (
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.92 }}>Inspect</div>

                <div
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    opacity: 0.8,
                    lineHeight: 1.35,
                    wordBreak: "break-word",
                  }}
                >
                  <div>URL:</div>
                  <div style={{ opacity: 0.7 }}>{location.href}</div>
                  <div style={{ marginTop: 8 }}>UA:</div>
                  <div style={{ opacity: 0.7 }}>{navigator.userAgent}</div>
                </div>
              </div>
            )}

            <div
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                borderRadius: 12,
                padding: 10,
                marginTop: 10,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.92 }}>Log</div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  fontSize: 11,
                  lineHeight: 1.35,
                  maxHeight: 160,
                  overflow: "auto",
                  marginTop: 8,
                }}
              >
                {logLines.join("\n")}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
