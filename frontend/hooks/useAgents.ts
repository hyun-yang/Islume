import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import {
  fetchAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgentActive,
  fetchAgentMarkdown,
  saveAgentMarkdown,
} from "@/lib/api";
import type { AgentCreate, AgentUpdate } from "@/lib/types";

export function useAgents() {
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useQuery({
    queryKey: ["agents", selectedUserId],
    queryFn: () => fetchAgents(selectedUserId!),
    enabled: !!selectedUserId,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: (data: AgentCreate) => createAgent(selectedUserId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", selectedUserId] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: AgentUpdate }) =>
      updateAgent(agentId, selectedUserId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", selectedUserId] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: (agentId: string) => deleteAgent(agentId, selectedUserId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", selectedUserId] });
    },
  });
}

export function useToggleAgent() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: (agentId: string) =>
      toggleAgentActive(agentId, selectedUserId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", selectedUserId] });
    },
  });
}

export function useAgentMarkdown(agentId: string | null) {
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useQuery({
    queryKey: ["agent-md", selectedUserId, agentId],
    queryFn: () => fetchAgentMarkdown(agentId!, selectedUserId!),
    enabled: !!selectedUserId && !!agentId,
  });
}

export function useSaveAgentMarkdown() {
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);

  return useMutation({
    mutationFn: ({ agentId, markdown }: { agentId: string; markdown: string }) =>
      saveAgentMarkdown(agentId, selectedUserId!, markdown),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agents", selectedUserId] });
      queryClient.invalidateQueries({
        queryKey: ["agent-md", selectedUserId, data.agent_id],
      });
    },
  });
}
