import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { fetchProfile, updateProfile, updateStatus, fetchModels } from "@/lib/api";
import type { ProfileUpdateRequest } from "@/lib/types";

export function useProfile() {
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useQuery({
    queryKey: ["profile", selectedUserId],
    queryFn: () => fetchProfile(selectedUserId!),
    enabled: !!selectedUserId,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: (data: ProfileUpdateRequest) =>
      updateProfile(selectedUserId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", selectedUserId] });
    },
  });
}

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => fetchModels(),
  });
}

export function useUpdateStatus() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: (status: { is_active?: boolean; is_visible?: boolean }) =>
      updateStatus(selectedUserId!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", selectedUserId] });
    },
  });
}
