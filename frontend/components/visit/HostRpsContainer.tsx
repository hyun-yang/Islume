"use client";

import { useAppStore } from "@/stores/appStore";
import RPSGameDialog from "@/components/visit/RPSGameDialog";
import { useT } from "@/lib/i18n";

export default function HostRpsContainer() {
  const t = useT();
  const accepted = useAppStore((s) => s.acceptedHostRpsRound);
  const setAcceptedHostRpsRound = useAppStore((s) => s.setAcceptedHostRpsRound);

  if (!accepted) return null;

  return (
    <RPSGameDialog
      role="host"
      myUserId={accepted.hostId}
      myDisplayName={accepted.hostName || t("common.you")}
      opponentDisplayName={accepted.visitorName || t("rps.visitor")}
      visitId={accepted.visitId}
      roundId={accepted.roundId}
      wagerAmount={accepted.wagerAmount}
      onClose={() => setAcceptedHostRpsRound(null)}
    />
  );
}
