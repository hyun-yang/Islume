import { useMutation } from "@tanstack/react-query";
import { createSession } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { DEFAULT_MAX_TURNS } from "@/lib/constants";

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
