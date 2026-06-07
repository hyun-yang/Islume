import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { updatePosition, fetchNearbyIslands } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { useProfile } from "@/hooks/useProfile";
import { DEFAULT_RADIUS_M } from "@/lib/constants";

export function useUpdatePosition() {
  const queryClient = useQueryClient();
  const setUserPosition = useAppStore((s) => s.setUserPosition);

  return useMutation({
    mutationFn: (params: { userId: string; longitude: number; latitude: number }) =>
      updatePosition(params.userId, params.longitude, params.latitude),
    onSuccess: (_data, variables) => {
      setUserPosition({
        longitude: variables.longitude,
        latitude: variables.latitude,
      });
      queryClient.invalidateQueries({ queryKey: ["nearby-islands"] });
    },
  });
}

export function useNearbyIslands() {
  const userPosition = useAppStore((s) => s.userPosition);
  const { data: profile } = useProfile();
  const radiusM = profile?.find_radius_m ?? DEFAULT_RADIUS_M;

  return useQuery({
    queryKey: ["nearby-islands", userPosition?.latitude, userPosition?.longitude, radiusM],
    queryFn: () =>
      fetchNearbyIslands(
        userPosition!.latitude,
        userPosition!.longitude,
        radiusM,
      ),
    enabled: userPosition !== null,
    refetchInterval: 5000,
  });
}
