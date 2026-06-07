"use client";

import { useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useFindMatch } from "@/hooks/useMatch";
import { useCreateSession } from "@/hooks/useSession";
import { useProfile, useUpdateProfile, useModels } from "@/hooks/useProfile";
import { useT } from "@/lib/i18n";
import type { MatchCandidate } from "@/lib/types";

/** Build deduplicated display labels: "Alice", or "Alice-1"/"Alice-2" when names collide. */
function buildDisplayLabels(candidates: MatchCandidate[]): string[] {
  const nameCount: Record<string, number> = {};
  const rawNames = candidates.map((c) => c.display_name || c.user_id.substring(0, 8));
  for (const name of rawNames) {
    nameCount[name] = (nameCount[name] || 0) + 1;
  }
  const nameSeen: Record<string, number> = {};
  return rawNames.map((name) => {
    if (nameCount[name] > 1) {
      nameSeen[name] = (nameSeen[name] || 0) + 1;
      return `${name}-${nameSeen[name]}`;
    }
    return name;
  });
}

export default function ControlPanel() {
  const t = useT();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const matchCandidates = useAppStore((s) => s.matchCandidates);
  const selectedMatches = useAppStore((s) => s.selectedMatches);
  const toggleMatchSelection = useAppStore((s) => s.toggleMatchSelection);
  const matchStatus = useAppStore((s) => s.matchStatus);
  const sessionStatus = useAppStore((s) => s.sessionStatus);

  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const { data: modelsData } = useModels();
  const findMatch = useFindMatch();
  const createSession = useCreateSession();

  const searchMode = profile?.search_mode ?? "exact_tags";
  const minSimilarity = profile?.min_similarity ?? 0.3;
  const systemModel = modelsData?.system_model ?? "";

  const SEARCH_MODES = [
    { value: "show_all", label: t("control.showAll"), desc: t("control.showAllDesc") },
    { value: "exact_tags", label: t("control.exactTags"), desc: t("control.exactTagsDesc") },
    {
      value: "semantic",
      label: t("control.semantic"),
      desc: systemModel ? `${t("control.semanticDesc")} (${systemModel})` : t("control.semanticDesc"),
    },
  ];

  const displayLabels = useMemo(
    () => buildDisplayLabels(matchCandidates),
    [matchCandidates]
  );

  const handleModeChange = (mode: string) => {
    updateProfile.mutate({ search_mode: mode });
  };

  const handleMinSimChange = (value: number) => {
    updateProfile.mutate({ min_similarity: value });
  };

  const handleFindMatch = () => {
    if (!selectedUserId) return;
    findMatch.mutate({
      userId: selectedUserId,
      radiusM: profile?.find_radius_m,
      minSimilarity: searchMode === "show_all" ? undefined : minSimilarity,
      searchMode,
    });
  };

  const handleStartSession = async () => {
    if (!selectedUserId || selectedMatches.length === 0) return;
    for (const match of selectedMatches) {
      await createSession.mutateAsync({
        userAId: selectedUserId,
        userBId: match.user_id,
        similarityScore: match.similarity_score,
        matchContext: `Matched by ${searchMode} (score: ${match.similarity_score.toFixed(2)})`,
      });
    }
  };

  if (!selectedUserId) {
    return (
      <p className="text-sm text-zinc-400">{t("control.selectUserToStart")}</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search mode selector */}
      <div>
        <label className="block text-xs font-medium text-zinc-500 mb-1">
          {t("control.searchMode")}
        </label>
        <div className="flex gap-1">
          {SEARCH_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => handleModeChange(m.value)}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                searchMode === m.value
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-400 mt-1">
          {SEARCH_MODES.find((m) => m.value === searchMode)?.desc}
        </div>
      </div>

      {/* Min similarity slider — hidden in show_all mode */}
      {searchMode !== "show_all" && (
        <div>
          <label className="text-xs text-zinc-500">
            {t("control.minSimilarity")}: {(minSimilarity * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minSimilarity * 100}
            onChange={(e) => handleMinSimChange(Number(e.target.value) / 100)}
            className="w-full"
          />
        </div>
      )}

      {/* Find Match */}
      <button
        onClick={handleFindMatch}
        disabled={findMatch.isPending || sessionStatus === "active"}
        className="w-full px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {findMatch.isPending
          ? searchMode === "semantic"
            ? t("control.analyzingLlm")
            : t("control.searching")
          : t("control.findMatch")}
      </button>

      {/* Candidate list */}
      {matchStatus === "found" && matchCandidates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-zinc-500">
            {matchCandidates.length} {t("control.candidatesFound")}
            {selectedMatches.length > 0 && (
              <span className="text-emerald-600 ml-1">
                ({selectedMatches.length} {t("control.selected")})
              </span>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {matchCandidates.map((c, i) => {
              const isSelected = selectedMatches.some(
                (m) => m.user_id === c.user_id && m.agent_id === c.agent_id
              );
              return (
                <button
                  key={`${c.user_id}-${c.agent_id}-${i}`}
                  onClick={() => toggleMatchSelection(c)}
                  className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${
                    isSelected
                      ? "bg-emerald-100 border border-emerald-300"
                      : "bg-zinc-50 hover:bg-zinc-100 border border-transparent"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-zinc-800">
                      {displayLabels[i]}
                      {c.agent_name && (
                        <span className="text-zinc-500 font-normal"> ({c.agent_name})</span>
                      )}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {(c.distance_m / 1000).toFixed(1)} km
                    </span>
                  </div>
                  {searchMode !== "show_all" && (
                    <div className="text-xs text-zinc-500">
                      {t("control.similarity")}: {(c.similarity_score * 100).toFixed(0)}%
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {matchStatus === "no_match" && (
        <p className="text-sm text-zinc-500">
          {t("control.noMatchesFound")}
        </p>
      )}

      {/* Start Session — only when candidates are selected */}
      {selectedMatches.length > 0 && sessionStatus !== "active" && (
        <button
          onClick={handleStartSession}
          disabled={createSession.isPending}
          className="w-full px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createSession.isPending
            ? t("control.creating")
            : selectedMatches.length === 1
              ? t("control.startSession")
              : `${t("control.start")} ${selectedMatches.length} ${t("control.sessions")}`}
        </button>
      )}
    </div>
  );
}
