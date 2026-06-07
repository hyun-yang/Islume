import { useQuery } from "@tanstack/react-query";
import { fetchUserSessions } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";

export function useUserSessions() {
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useQuery({
    queryKey: ["sessions", selectedUserId],
    queryFn: () => fetchUserSessions(selectedUserId!),
    enabled: !!selectedUserId,
    refetchInterval: 10000,
  });
}
