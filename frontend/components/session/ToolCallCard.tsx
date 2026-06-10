"use client";

import type { ToolCallEventPayload } from "@/lib/types";
import { useT } from "@/lib/i18n";

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  auto_confirmed: { bg: "bg-sky-50", border: "border-sky-300", text: "text-sky-800" },
  user_confirmed: { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-800" },
  pending: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-800" },
  user_rejected: { bg: "bg-rose-50", border: "border-rose-300", text: "text-rose-800" },
  auto_rejected: { bg: "bg-zinc-50", border: "border-zinc-300", text: "text-zinc-600" },
  expired: { bg: "bg-zinc-50", border: "border-zinc-300", text: "text-zinc-500" },
};

const STATUS_LABEL_KEY: Record<string, string> = {
  auto_confirmed: "tool.statusAuto",
  user_confirmed: "tool.statusApproved",
  pending: "tool.statusPending",
  user_rejected: "tool.statusRejected",
  auto_rejected: "tool.statusBlocked",
  expired: "tool.statusExpired",
};


function BarteringProposal({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { amount?: number; currency?: string; item_name?: string; terms?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">
        {payload.tool_name === "counter_offer" ? t("tool.counterOffer") : t("tool.proposed")}{" "}
        {a.amount} {a.currency || ""}
      </span>
      {a.item_name && <span> {t("tool.for")} {a.item_name}</span>}
      {a.terms && (
        <div className="mt-1 text-xs text-zinc-600 italic">&ldquo;{a.terms}&rdquo;</div>
      )}
    </div>
  );
}

function BarteringAccept({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { amount?: number };
  return (
    <div className="text-sm font-semibold">{t("tool.acceptedAt")} {a.amount}</div>
  );
}

function BarteringReject({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { reason?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">{t("tool.rejected")}</span>
      {a.reason && <span className="text-zinc-600"> — {a.reason}</span>}
    </div>
  );
}

function BarteringReference({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { kind?: string; url?: string; label?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">{t("tool.shared")} {a.kind || t("tool.link")}:</span>{" "}
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-sky-700"
      >
        {a.label || a.url}
      </a>
    </div>
  );
}

function BarteringWithdraw({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { reason?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">{t("tool.withdrew")}</span>
      {a.reason && <span className="text-zinc-600"> — {a.reason}</span>}
    </div>
  );
}

function InterviewRequest({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { message?: string; position?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">💼 {t("tool.interviewRequested")}</span>
      {a.position && <span> — {a.position}</span>}
      {a.message && (
        <div className="mt-1 text-xs text-zinc-600 italic">&ldquo;{a.message}&rdquo;</div>
      )}
    </div>
  );
}

function InterviewAccept({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { message?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">🤝 {t("tool.interviewAccepted")}</span>
      {a.message && (
        <div className="mt-1 text-xs text-zinc-600 italic">&ldquo;{a.message}&rdquo;</div>
      )}
    </div>
  );
}

function InterviewDecline({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { reason?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">{t("tool.interviewDeclined")}</span>
      {a.reason && <span className="text-zinc-600"> — {a.reason}</span>}
    </div>
  );
}

function OfflineMeetingProposal({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { place_hint?: string; time_hint?: string; message?: string };
  const hint = [a.place_hint, a.time_hint].filter(Boolean).join(" · ");
  return (
    <div className="text-sm">
      <span className="font-semibold">💜 {t("tool.offlineProposed")}</span>
      {hint && <span> — {hint}</span>}
      {a.message && (
        <div className="mt-1 text-xs text-zinc-600 italic">&ldquo;{a.message}&rdquo;</div>
      )}
    </div>
  );
}

function OfflineMeetingAccept({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { message?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">💜 {t("tool.offlineAccepted")}</span>
      {a.message && (
        <div className="mt-1 text-xs text-zinc-600 italic">&ldquo;{a.message}&rdquo;</div>
      )}
    </div>
  );
}

function OfflineMeetingDecline({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as { reason?: string };
  return (
    <div className="text-sm">
      <span className="font-semibold">{t("tool.offlineDeclined")}</span>
      {a.reason && <span className="text-zinc-600"> — {a.reason}</span>}
    </div>
  );
}

function ShareContact({ payload }: { payload: ToolCallEventPayload }) {
  const t = useT();
  const a = payload.arguments as {
    redacted?: boolean;
    channel?: string;
    handle?: string;
    message?: string;
  };
  // Pre-approval the shared stream carries {"redacted": true} only.
  if (a.redacted) {
    return (
      <div className="text-sm">
        <span className="font-semibold">🔒 {t("tool.contactRedacted")}</span>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <span className="font-semibold">📇 {t("tool.contactShared")}</span>
      {a.channel && (
        <span>
          {" "}
          — {a.channel}: <span className="font-mono">{a.handle}</span>
        </span>
      )}
      {a.message && (
        <div className="mt-1 text-xs text-zinc-600 italic">&ldquo;{a.message}&rdquo;</div>
      )}
    </div>
  );
}

function GenericPayload({ payload }: { payload: ToolCallEventPayload }) {
  return (
    <div className="text-sm">
      <span className="font-semibold">{payload.tool_name}</span>
      <pre className="mt-1 text-xs bg-white/50 rounded p-1 overflow-x-auto">
        {JSON.stringify(payload.arguments, null, 2)}
      </pre>
    </div>
  );
}

function ToolCallBody({ payload }: { payload: ToolCallEventPayload }) {
  if (payload.plugin === "bartering") {
    switch (payload.tool_name) {
      case "propose_price":
      case "counter_offer":
        return <BarteringProposal payload={payload} />;
      case "accept_offer":
        return <BarteringAccept payload={payload} />;
      case "reject_offer":
        return <BarteringReject payload={payload} />;
      case "share_reference":
        return <BarteringReference payload={payload} />;
      case "withdraw":
        return <BarteringWithdraw payload={payload} />;
    }
  }
  if (payload.plugin === "job_interview") {
    switch (payload.tool_name) {
      case "request_interview":
        return <InterviewRequest payload={payload} />;
      case "accept_interview":
        return <InterviewAccept payload={payload} />;
      case "decline_interview":
        return <InterviewDecline payload={payload} />;
    }
  }
  if (payload.plugin === "dating_contact") {
    switch (payload.tool_name) {
      case "propose_offline_meeting":
        return <OfflineMeetingProposal payload={payload} />;
      case "accept_offline_meeting":
        return <OfflineMeetingAccept payload={payload} />;
      case "decline_offline_meeting":
        return <OfflineMeetingDecline payload={payload} />;
      case "share_contact":
        return <ShareContact payload={payload} />;
    }
  }
  return <GenericPayload payload={payload} />;
}

export default function ToolCallCard({
  payload,
}: {
  payload: ToolCallEventPayload;
}) {
  const t = useT();
  const c = STATUS_COLORS[payload.status] ?? STATUS_COLORS.auto_confirmed;
  const statusKey = STATUS_LABEL_KEY[payload.status];
  return (
    <div className={`p-3 rounded-lg border ${c.bg} ${c.border}`}>
      <div className={`text-[10px] uppercase tracking-wide mb-1 ${c.text}`}>
        {payload.plugin} · {statusKey ? t(statusKey) : payload.status}
      </div>
      <ToolCallBody payload={payload} />
      {payload.reason && payload.status === "auto_rejected" && (
        <div className="mt-1 text-xs text-zinc-500">⚠ {payload.reason}</div>
      )}
      {payload.policy_reason && payload.status === "pending" && (
        <div className="mt-1 text-xs text-amber-600">⏳ {payload.policy_reason}</div>
      )}
    </div>
  );
}
