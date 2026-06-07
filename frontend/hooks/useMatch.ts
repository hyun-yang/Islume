import { useMutation } from "@tanstack/react-query";
import { findMatch } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { DEFAULT_RADIUS_M } from "@/lib/constants";

interface FindMatchParams {
  userId: string;
  radiusM?: number;
  minSimilarity?: number;
  searchMode?: string;
}

export function useFindMatch() {
  const setMatchCandidates = useAppStore((s) => s.setMatchCandidates);
  const clearMatchSelection = useAppStore((s) => s.clearMatchSelection);
  const setMatchStatus = useAppStore((s) => s.setMatchStatus);

  return useMutation({
    mutationFn: ({ userId, radiusM, minSimilarity, searchMode }: FindMatchParams) =>
      findMatch(userId, radiusM ?? DEFAULT_RADIUS_M, minSimilarity, searchMode),
    onMutate: () => {
      setMatchStatus("searching");
    },
    onSuccess: (data) => {
      if (data.candidates.length > 0) {
        setMatchCandidates(data.candidates);
        clearMatchSelection();
        setMatchStatus("found");
      } else {
        setMatchCandidates([]);
        clearMatchSelection();
        setMatchStatus("no_match");
      }
    },
    onError: () => {
      setMatchStatus("idle");
    },
  });
}
