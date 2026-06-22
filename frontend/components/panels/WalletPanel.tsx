"use client";

import { useState } from "react";
import { useWallet, useTransactions, useWithdrawals, useSupply } from "@/hooks/useWallet";
import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";

// Status badge color per withdrawal status.
const STATUS_CLASS: Record<string, string> = {
  pending: "text-amber-600",
  minting: "text-amber-600",
  confirmed: "text-emerald-600",
  failed: "text-red-500",
};

export default function WalletPanel() {
  const t = useT();
  const { data: wallet, isLoading } = useWallet();
  const { data: txData } = useTransactions(5, 0);
  const { data: withdrawalData } = useWithdrawals(5);
  const { data: supply } = useSupply();
  const setShowTransferModal = useAppStore((s) => s.setShowTransferModal);
  const setShowWithdrawModal = useAppStore((s) => s.setShowWithdrawModal);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isLoading || !wallet) {
    return <div className="p-4 text-sm text-zinc-400">{t("wallet.loadingWallet")}</div>;
  }

  const truncatedAddress = `${wallet.solana_address.slice(0, 6)}…${wallet.solana_address.slice(-6)}`;

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.solana_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-700">{t("wallet.title")}</h2>
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowTransferModal(true)}
            className="px-3 py-1 text-xs font-medium text-white bg-zinc-800 rounded-md hover:bg-zinc-700 transition-colors"
          >
            {t("wallet.sendIsl")}
          </button>
          <button
            onClick={() => setShowWithdrawModal(true)}
            className="px-3 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 rounded-md hover:bg-zinc-200 transition-colors"
          >
            {t("wallet.withdraw")}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <div className="text-3xl font-bold text-zinc-900 tabular-nums">
          {wallet.balance.toLocaleString()}
          <span className="text-base font-medium text-zinc-400 ml-1.5">ISL</span>
        </div>
      </div>

      <div className="mb-3 space-y-0.5">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">
          {t("wallet.solanaAddressLabel")}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyAddress}
            className="text-xs text-zinc-500 hover:text-zinc-700 font-mono transition-colors"
            title={t("wallet.copyAddressTitle")}
          >
            {copied ? t("wallet.copied") : truncatedAddress}
          </button>
          <a
            href={`https://explorer.solana.com/address/${wallet.solana_address}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            {t("wallet.viewOnExplorer")}
          </a>
        </div>
      </div>

      {supply && (
        <div className="mb-3 rounded-md border border-zinc-100 bg-zinc-50 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">
            {t("wallet.supplyTitle")}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-zinc-400">{t("wallet.totalIssued")}</div>
              <div className="font-semibold text-zinc-800 tabular-nums">
                {supply.total_issued.toLocaleString()} ISL
              </div>
            </div>
            <div>
              <div className="text-zinc-400">{t("wallet.onChainSupply")}</div>
              <div className="font-semibold text-zinc-800 tabular-nums">
                {supply.on_chain_supply.toLocaleString()}
                {supply.on_chain_cap > 0 && (
                  <span className="font-normal text-zinc-400">
                    {" "}/ {supply.on_chain_cap.toLocaleString()}
                  </span>
                )}{" "}
                ISL
              </div>
            </div>
          </div>
          {supply.mint_address && (
            <a
              href={`https://explorer.solana.com/address/${supply.mint_address}?cluster=${supply.cluster}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-xs text-blue-500 hover:underline"
            >
              {t("wallet.viewMintOnExplorer")}
            </a>
          )}
        </div>
      )}

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

      {withdrawalData && withdrawalData.withdrawals.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-zinc-500 mb-2">
            {t("wallet.withdrawals")}
          </div>
          <div className="space-y-1.5">
            {withdrawalData.withdrawals.map((w) => (
              <div
                key={w.withdrawal_id}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-red-500 font-medium">
                    -{w.amount.toLocaleString()}
                  </span>
                  <span className={STATUS_CLASS[w.status] ?? "text-zinc-400"}>
                    {t(`wallet.status.${w.status}`)}
                  </span>
                </div>
                {w.solana_signature ? (
                  <a
                    href={`https://explorer.solana.com/tx/${w.solana_signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {t("wallet.viewOnExplorer")}
                  </a>
                ) : (
                  <span className="text-zinc-400 font-mono">
                    {w.destination_address.slice(0, 4)}…
                    {w.destination_address.slice(-4)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
