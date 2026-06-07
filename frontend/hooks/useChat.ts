import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { fetchChatRooms, createChatRoom, fetchChatMessages } from "@/lib/api";

export function useChatRooms() {
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useQuery({
    queryKey: ["chatRooms", selectedUserId],
    queryFn: () => fetchChatRooms(selectedUserId!),
    enabled: !!selectedUserId,
  });
}

export function useCreateChatRoom() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: ({
      memberIds,
      roomType,
      name,
    }: {
      memberIds: string[];
      roomType: string;
      name?: string;
    }) => createChatRoom(roomType, memberIds, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chatRooms", selectedUserId] });
    },
  });
}

export function useChatMessages(roomId: string | null) {
  return useQuery({
    queryKey: ["chatMessages", roomId],
    queryFn: () => fetchChatMessages(roomId!),
    enabled: !!roomId,
    refetchInterval: 3000, // Poll every 3s as fallback to WS
  });
}
