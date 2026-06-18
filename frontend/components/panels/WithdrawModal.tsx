"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useWithdraw, useWallet } from "@/hooks/useWallet";
import { useT } from "@/lib/i18n";

export default function WithdrawModal() {
  const t = useT();
  const show = useAppStore((s) => s.showWithdrawModal);
  const setShow = useAppStore((s) => s.setShowWithdrawModal);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const { data: wallet } = useWallet();
  const withdraw = useWithdraw();

  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  if (!show || !selectedUserId) return null;

  const amountNum = parseInt(amount, 10);
  const maxBalance = wallet?.balance ?? 0;
  // base58 Solana pubkeys are 32-44 chars; the server re-validates strictly.
  const isValid =
    address.trim().length >= 32 && amountNum > 0 && amountNum <= maxBalance;

  const handleSubmit = () => {
    if (!isValid) return;
    setError("");
    withdraw.mutate(
      {
        from_user_id: selectedUserId,
        amount: amountNum,
        destination_address: address.trim(),
      },
      {
        onSuccess: () => {
          setAddress("");
          setAmount("");
          setShow(false);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : t("wallet.withdrawFailed"));
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-[360px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-800">
            {t("wallet.withdrawToSolana")}
          </h3>
          <button
            onClick={() => setShow(false)}
            className="text-zinc-400 hover:text-zinc-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="mb-3 text-xs text-zinc-500">
          {t("wallet.balance")}:{" "}
          <span className="font-medium text-zinc-700">
            {maxBalance.toLocaleString()} ISL
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-zinc-600">
                {t("wallet.solanaAddress")}
              </label>
              {wallet?.solana_address && (
                <button
                  type="button"
                  onClick={() => setAddress(wallet.solana_address)}
                  className="text-[11px] text-blue-500 hover:underline"
                >
                  {t("wallet.useMyAddress")}
                </button>
              )}
            </div>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 7xKX...WdsX"
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-400 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">
              {t("wallet.withdrawAmount")}
            </label>
            <input
              type="number"
              min="1"
              max={maxBalance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-400 tabular-nums"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">
            {error}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setShow(false)}
            className="flex-1 px-3 py-2 text-sm text-zinc-600 border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || withdraw.isPending}
            className="flex-1 px-3 py-2 text-sm text-white bg-zinc-800 rounded-md hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {withdraw.isPending
              ? t("wallet.withdrawing")
              : `${t("wallet.withdraw")} ${amountNum > 0 ? amountNum.toLocaleString() : ""} ISL`}
          </button>
        </div>
      </div>
    </div>
  );
}
