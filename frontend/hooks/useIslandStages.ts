import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchIslandStages,
  saveIslandStage,
  markIslandStageCleared,
  publishIslandStage,
  unpublishIslandStage,
  deleteIslandStage,
} from "@/lib/api";
import type { StageLevelData } from "@/lib/types";

// publishedOnly is part of the query key so the editor (all slots) and the
// visitor view (published only) never share a cache entry; invalidating the
// ["islandStages", islandId] prefix refreshes both.
export function useIslandStages(islandId: string | null, publishedOnly = false) {
  return useQuery({
    queryKey: ["islandStages", islandId, publishedOnly],
    queryFn: () => fetchIslandStages(islandId!, publishedOnly),
    enabled: !!islandId,
  });
}

function useInvalidateStages(islandId: string | null) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ["islandStages", islandId] });
}

export function useSaveIslandStage(islandId: string | null) {
  const invalidate = useInvalidateStages(islandId);
  return useMutation({
    mutationFn: (data: { slot: number; name: string; levelData: StageLevelData }) =>
      saveIslandStage(islandId!, data.slot, data.name, data.levelData),
    onSuccess: invalidate,
  });
}

export function useMarkStageCleared(islandId: string | null) {
  const invalidate = useInvalidateStages(islandId);
  return useMutation({
    mutationFn: (slot: number) => markIslandStageCleared(islandId!, slot),
    onSuccess: invalidate,
  });
}

export function usePublishIslandStage(islandId: string | null) {
  const invalidate = useInvalidateStages(islandId);
  return useMutation({
    mutationFn: (slot: number) => publishIslandStage(islandId!, slot),
    onSuccess: invalidate,
  });
}

export function useUnpublishIslandStage(islandId: string | null) {
  const invalidate = useInvalidateStages(islandId);
  return useMutation({
    mutationFn: (slot: number) => unpublishIslandStage(islandId!, slot),
    onSuccess: invalidate,
  });
}

export function useDeleteIslandStage(islandId: string | null) {
  const invalidate = useInvalidateStages(islandId);
  return useMutation({
    mutationFn: (slot: number) => deleteIslandStage(islandId!, slot),
    onSuccess: invalidate,
  });
}
