"use client";

import { useState } from "react";
import { useWallet, useTransactions } from "@/hooks/useWallet";
import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";

export default function WalletPanel() {
  const t = useT();
  const { data: wallet, isLoading } = useWallet();
  const { data: txData } = useTransactions(5, 0);
  const setShowTransferModal = useAppStore((s) => s.setShowTransferModal);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isLoading || !wallet) {
    return <div className="p-4 text-sm text-zinc-400">{t("wallet.loadingWallet")}</div>;
  }

  const truncatedKey = `${wallet.public_key.slice(0, 8)}...${wallet.public_key.slice(-8)}`;

  const copyKey = () => {
    navigator.clipboard.writeText(wallet.public_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-700">{t("wallet.title")}</h2>
        <button
          onClick={() => setShowTransferModal(true)}
          className="px-3 py-1 text-xs font-medium text-white bg-zinc-800 rounded-md hover:bg-zinc-700 transition-colors"
        >
          {t("wallet.sendIsl")}
        </button>
      </div>

      <div className="mb-3">
        <div className="text-3xl font-bold text-zinc-900 tabular-nums">
          {wallet.balance.toLocaleString()}
          <span className="text-base font-medium text-zinc-400 ml-1.5">ISL</span>
        </div>
      </div>

      <div className="mb-3">
        <button
          onClick={copyKey}
          className="text-xs text-zinc-500 hover:text-zinc-700 font-mono transition-colors"
          title={t("wallet.copyKeyTitle")}
        >
          {copied ? t("wallet.copied") : truncatedKey}
        </button>
      </div>

      {txData && txData.entries.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700 mb-2"
          >
            {t("wallet.recentTransactions")} {expanded ? "[-]" : `[${txData.total}]`}
          </button>

          {expanded && (
            <div className="space-y-1.5">
              {txData.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        entry.amount > 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"
                      }
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount.toLocaleString()}
                    </span>
                    <span className="text-zinc-400">{entry.tx_type}</span>
                  </div>
                  <span className="text-zinc-400">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
