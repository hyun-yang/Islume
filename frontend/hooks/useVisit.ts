import { useMutation } from "@tanstack/react-query";
import { createVisit, endVisit } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import type { GameId } from "@/lib/types";

export function useStartVisit() {
  const beginVisit = useAppStore((s) => s.beginVisit);
  const cancelVisitRequest = useAppStore((s) => s.cancelVisitRequest);

  return useMutation({
    mutationFn: async ({
      visitorId,
      hostId,
      hostName,
      gameId,
    }: {
      visitorId: string;
      hostId: string;
      hostName: string;
      gameId: GameId;
    }) => {
      const visit = await createVisit(visitorId, hostId);
      return { visit, hostName, gameId };
    },
    onSuccess: ({ visit, hostName, gameId }) => {
      beginVisit(visit.id, visit.host_id, hostName, gameId);
    },
    onError: () => {
      cancelVisitRequest();
    },
  });
}

export function useEndVisit() {
  const endState = useAppStore((s) => s.endVisitState);

  return useMutation({
    mutationFn: async (visitId: string) => {
      await endVisit(visitId);
    },
    onSettled: () => {
      endState();
    },
  });
}
