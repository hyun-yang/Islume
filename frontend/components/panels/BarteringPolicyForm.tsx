"use client";

import type { BarteringPolicy } from "@/lib/types";
import { useT } from "@/lib/i18n";

const EMPTY: BarteringPolicy = {
  role: "seller",
  item_name: "",
  currency: "ISL",
  price_range: { min: 0, max: 0 },
};

export const BARTERING_EMPTY_POLICY: BarteringPolicy = EMPTY;

export default function BarteringPolicyForm({
  value,
  onChange,
}: {
  value: BarteringPolicy;
  onChange: (next: BarteringPolicy) => void;
}) {
  const t = useT();
  const num = (v: string): number => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <label className="flex-1">
          <div className="text-zinc-600 mb-0.5">{t("barter.role")}</div>
          <select
            value={value.role}
            onChange={(e) => onChange({ ...value, role: e.target.value as "seller" | "buyer" })}
            className="w-full rounded border border-zinc-300 px-2 py-1"
          >
            <option value="seller">{t("barter.seller")}</option>
            <option value="buyer">{t("barter.buyer")}</option>
          </select>
        </label>
        <label className="w-24">
          <div className="text-zinc-600 mb-0.5">{t("barter.currency")}</div>
          <select
            value={value.currency}
            onChange={(e) => onChange({ ...value, currency: e.target.value as "ISL" | "USD" })}
            className="w-full rounded border border-zinc-300 px-2 py-1"
          >
            <option value="ISL">ISL</option>
            <option value="USD">USD</option>
          </select>
        </label>
      </div>

      <label className="block">
        <div className="text-zinc-600 mb-0.5">{t("barter.itemName")}</div>
        <input
          value={value.item_name}
          onChange={(e) => onChange({ ...value, item_name: e.target.value })}
          placeholder={t("barter.itemNamePlaceholder")}
          className="w-full rounded border border-zinc-300 px-2 py-1"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex-1">
          <div className="text-zinc-600 mb-0.5">{t("barter.priceMin")}</div>
          <input
            type="number"
            min={0}
            value={value.price_range.min}
            onChange={(e) =>
              onChange({
                ...value,
                price_range: { ...value.price_range, min: num(e.target.value) },
              })
            }
            className="w-full rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex-1">
          <div className="text-zinc-600 mb-0.5">{t("barter.priceMax")}</div>
          <input
            type="number"
            min={0}
            value={value.price_range.max}
            onChange={(e) =>
              onChange({
                ...value,
                price_range: { ...value.price_range, max: num(e.target.value) },
              })
            }
            className="w-full rounded border border-zinc-300 px-2 py-1"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <label className="flex-1">
          <div className="text-zinc-600 mb-0.5">{t("barter.autoAccept")}</div>
          <input
            type="number"
            min={0}
            value={value.auto_accept_at_or_above ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                auto_accept_at_or_above: e.target.value === "" ? undefined : num(e.target.value),
              })
            }
            placeholder={t("barter.optional")}
            className="w-full rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex-1">
          <div className="text-zinc-600 mb-0.5">{t("barter.autoReject")}</div>
          <input
            type="number"
            min={0}
            value={value.auto_reject_below ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                auto_reject_below: e.target.value === "" ? undefined : num(e.target.value),
              })
            }
            placeholder={t("barter.optional")}
            className="w-full rounded border border-zinc-300 px-2 py-1"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-zinc-600 mb-0.5">{t("barter.photoUrl")}</div>
        <input
          value={value.photo_url ?? ""}
          onChange={(e) =>
            onChange({ ...value, photo_url: e.target.value || undefined })
          }
          placeholder="https://…"
          className="w-full rounded border border-zinc-300 px-2 py-1"
        />
      </label>
    </div>
  );
}
