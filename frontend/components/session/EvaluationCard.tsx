"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { fetchSessionEvaluations, respondToAffinity } from "@/lib/api";
import { useT } from "@/lib/i18n";

// verdict field → i18n label key (shared across templates)
const VERDICT_LABEL_KEYS: Record<string, string> = {
  meet_again: "eval.verdict.meetAgain",
  offline_meeting: "eval.verdict.offlineMeeting",
  candidate_suitable: "eval.verdict.candidateSuitable",
  request_interview: "eval.verdict.requestInterview",
  company_impression: "eval.verdict.companyImpression",
  want_interview: "eval.verdict.wantInterview",
  share_contact: "eval.verdict.shareContact",
  continue_relationship: "eval.verdict.continueRelationship",
};

export default function EvaluationCard() {
  const t = useT();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const sessionStatus = useAppStore((s) => s.sessionStatus);
  const finalEvaluation = useAppStore((s) => s.finalEvaluation);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const setFinalEvaluation = useAppStore((s) => s.setFinalEvaluation);

  const { data: evaluations } = useQuery({
    queryKey: ["evaluations", activeSessionId, selectedUserId],
    queryFn: () => fetchSessionEvaluations(activeSessionId!, selectedUserId!),
    enabled: !!activeSessionId && !!selectedUserId,
  });

  const respondMutation = useMutation({
    mutationFn: (action: "continue" | "end") =>
      respondToAffinity(activeSessionId!, selectedUserId!, action),
    onSuccess: (result) => {
      if (result.status === "resumed") {
        setSessionStatus("active");
        setFinalEvaluation(null);
      } else if (result.status === "ended") {
        setSessionStatus("ended");
        setFinalEvaluation(null);
      }
      // "waiting" — keep the card; the other user still has to respond
    },
  });

  // Latest evaluation (rows arrive newest-first from the API).
  const evaluation = evaluations?.[0];
  if (!evaluation) return null;

  const awaitingDecision =
    sessionStatus === "awaiting_review" &&
    finalEvaluation?.reason === "max_turns";

  return (
    <div className="p-4 rounded-lg bg-indigo-50 border border-indigo-200 space-y-3">
      <div className="text-xs font-semibold text-indigo-700">
        {t("eval.title")}
        <span className="text-zinc-400 font-normal ml-2">
          {finalEvaluation?.reason === "session_end" ||
          evaluation.trigger === "session_end"
            ? t("eval.triggerSessionEnd")
            : t("eval.triggerMaxTurns")}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {evaluation.score !== null && (
          <div className="text-3xl font-bold text-indigo-700">
            {evaluation.score}
          </div>
        )}
        {evaluation.summary && (
          <div className="text-sm text-zinc-600">{evaluation.summary}</div>
        )}
      </div>

      {/* Category-specific verdict chips */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(evaluation.verdicts).map(([field, value]) => {
          const label = t(VERDICT_LABEL_KEYS[field] ?? field);
          const positive = value === true || value === "good";
          const display =
            typeof value === "boolean"
              ? positive
                ? t("eval.yes")
                : t("eval.no")
              : String(value);
          return (
            <span
              key={field}
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                positive
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : "bg-zinc-100 border-zinc-300 text-zinc-600"
              }`}
            >
              {label}: {display}
            </span>
          );
        })}
      </div>

      {awaitingDecision && (
        <div className="flex gap-2">
          <button
            onClick={() => respondMutation.mutate("continue")}
            disabled={respondMutation.isPending}
            className="flex-1 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {t("eval.continueExtend")}
          </button>
          <button
            onClick={() => respondMutation.mutate("end")}
            disabled={respondMutation.isPending}
            className="flex-1 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {t("session.endConversation")}
          </button>
        </div>
      )}
    </div>
  );
}
