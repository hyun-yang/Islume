import { useMutation, useQuery } from "@tanstack/react-query";
import { createSession, fetchSessionTurns } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { DEFAULT_MAX_TURNS } from "@/lib/constants";

/** Durable conversation history from Postgres. The viewer merges this with the
 *  live WS turns, so a finished session shows its turns even when its Redis
 *  stream is gone (cleared on restart). */
export function useSessionTurns(sessionId: string | null) {
  return useQuery({
    queryKey: ["sessionTurns", sessionId],
    queryFn: () => fetchSessionTurns(sessionId!),
    enabled: !!sessionId,
  });
}

export function useCreateSession() {
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);

  return useMutation({
    mutationFn: (params: {
      userAId: string;
      userBId: string;
      similarityScore: number;
      matchContext: string;
    }) =>
      createSession(
        params.userAId,
        params.userBId,
        params.similarityScore,
        params.matchContext,
        DEFAULT_MAX_TURNS,
      ),
    onMutate: () => {
      setSessionStatus("creating");
    },
    onSuccess: (data) => {
      setActiveSession(data.session_id);
    },
    onError: () => {
      setSessionStatus("none");
    },
  });
}
