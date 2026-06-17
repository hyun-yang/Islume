import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import {
  fetchWallet,
  transferISL,
  fetchTransactions,
  createWithdrawal,
  fetchWithdrawals,
} from "@/lib/api";
import type { TransferRequest, WithdrawalRequest, WithdrawalListResponse } from "@/lib/types";

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
    // Every transfer intent gets one idempotency key, so a network retry of
    // the same intent can never double-spend (caller-supplied key wins).
    mutationFn: (data: TransferRequest) =>
      transferISL({ idempotency_key: crypto.randomUUID(), ...data }),
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

export function useWithdraw() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  return useMutation({
    // One idempotency key per intent — a network retry can't double-debit.
    mutationFn: (data: WithdrawalRequest) =>
      createWithdrawal({ idempotency_key: crypto.randomUUID(), ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["balance", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["withdrawals", selectedUserId] });
    },
  });
}

export function useWithdrawals(limit = 10) {
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  return useQuery({
    queryKey: ["withdrawals", selectedUserId, limit],
    queryFn: () => fetchWithdrawals(selectedUserId!, limit),
    enabled: !!selectedUserId,
    // Poll while any withdrawal is in flight (Devnet confirms in seconds); the
    // mint worker updates the row pending → minting → confirmed/failed.
    refetchInterval: (query) => {
      const data = query.state.data as WithdrawalListResponse | undefined;
      const inFlight = data?.withdrawals.some(
        (w) => w.status === "pending" || w.status === "minting",
      );
      return inFlight ? 3000 : false;
    },
  });
}
