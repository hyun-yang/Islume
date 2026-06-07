import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { fetchWallet, transferISL, fetchTransactions } from "@/lib/api";
import type { TransferRequest } from "@/lib/types";

export function useWallet() {
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  return useQuery({
    queryKey: ["wallet", selectedUserId],
    queryFn: () => fetchWallet(selectedUserId!),
    enabled: !!selectedUserId,
  });
}

export function useTransfer() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  return useMutation({
    mutationFn: (data: TransferRequest) => transferISL(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["balance", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", selectedUserId] });
    },
  });
}

export function useTransactions(limit = 20, offset = 0) {
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  return useQuery({
    queryKey: ["transactions", selectedUserId, limit, offset],
    queryFn: () => fetchTransactions(selectedUserId!, limit, offset),
    enabled: !!selectedUserId,
  });
}
