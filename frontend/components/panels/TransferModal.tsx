"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useTransfer, useWallet } from "@/hooks/useWallet";
import { SEED_USERS } from "@/lib/constants";
import { useT } from "@/lib/i18n";

export default function TransferModal() {
  const t = useT();
  const show = useAppStore((s) => s.showTransferModal);
  const setShow = useAppStore((s) => s.setShowTransferModal);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const { data: wallet } = useWallet();
  const transfer = useTransfer();

  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [txType, setTxType] = useState("tip");
  const [error, setError] = useState("");

  if (!show || !selectedUserId) return null;

  const recipients = SEED_USERS.filter((u) => u.id !== selectedUserId);
  const amountNum = parseInt(amount, 10);
  const maxBalance = wallet?.balance ?? 0;
  const isValid = recipientId && amountNum > 0 && amountNum <= maxBalance;

  const handleSubmit = () => {
    if (!isValid) return;
    setError("");
    transfer.mutate(
      {
        from_user_id: selectedUserId,
        to_user_id: recipientId,
        amount: amountNum,
        tx_type: txType,
      },
      {
        onSuccess: () => {
          setRecipientId("");
          setAmount("");
          setTxType("tip");
          setShow(false);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : t("wallet.transferFailed"));
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-[360px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-800">{t("wallet.sendIsl")}</h3>
          <button
            onClick={() => setShow(false)}
            className="text-zinc-400 hover:text-zinc-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="mb-3 text-xs text-zinc-500">
          {t("wallet.balance")}: <span className="font-medium text-zinc-700">{maxBalance.toLocaleString()} ISL</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">{t("wallet.recipient")}</label>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="">{t("wallet.selectUser")}</option>
              {recipients.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.suburb})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">{t("wallet.amount")}</label>
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

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">{t("wallet.type")}</label>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="tip">{t("wallet.typeTip")}</option>
              <option value="purchase">{t("wallet.typePurchase")}</option>
              <option value="gift">{t("wallet.typeGift")}</option>
              <option value="island_entry">{t("wallet.typeIslandEntry")}</option>
            </select>
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
            disabled={!isValid || transfer.isPending}
            className="flex-1 px-3 py-2 text-sm text-white bg-zinc-800 rounded-md hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {transfer.isPending
              ? t("wallet.sending")
              : `${t("wallet.send")} ${amountNum > 0 ? amountNum.toLocaleString() : ""} ISL`}
          </button>
        </div>
      </div>
    </div>
  );
}
