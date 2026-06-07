"use client";

import { SEED_USERS, DEFAULT_POSITIONS } from "@/lib/constants";
import { useAppStore, type Locale } from "@/stores/appStore";
import { useUpdatePosition } from "@/hooks/useIslands";
import { useT } from "@/lib/i18n";

// Region groups for the <optgroup> labels, in display order.
const GROUPS: { locale: Locale; labelKey: string }[] = [
  { locale: "en", labelKey: "user.regionBrisbane" },
  { locale: "ko", labelKey: "user.regionSeoul" },
  { locale: "ja", labelKey: "user.regionOsaka" },
];

export default function UserSelector() {
  const t = useT();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const selectUser = useAppStore((s) => s.selectUser);
  const setUserPosition = useAppStore((s) => s.setUserPosition);
  const setLocale = useAppStore((s) => s.setLocale);
  const updatePosition = useUpdatePosition();

  const userPosition = useAppStore((s) => s.userPosition);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    if (!userId) return;

    const user = SEED_USERS.find((u) => u.id === userId);
    if (!user) return;

    // Switch the UI to the selected user's language so the chrome matches the
    // region they're acting as (toggle still lets them override afterwards).
    setLocale(user.locale);

    // Re-selecting the same user (e.g. on a fresh page load with persisted
    // selection) should keep the user's last known position instead of
    // snapping back to the seed default.
    const isSameUser = selectedUserId === userId;
    selectUser(userId, user.name);

    if (isSameUser && userPosition) return;

    const pos = DEFAULT_POSITIONS[userId];
    if (pos) {
      // Set position immediately so the map can render the self-user marker
      // before the API call completes (critical for isolated users with no neighbors)
      setUserPosition(pos);
      updatePosition.mutate({
        userId,
        longitude: pos.longitude,
        latitude: pos.latitude,
      });
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 mb-1">
        {t("user.select")}
      </label>
      <select
        value={selectedUserId ?? ""}
        onChange={handleSelect}
        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="" disabled>
          {t("user.choose")}
        </option>
        {GROUPS.map((g) => (
          <optgroup key={g.locale} label={t(g.labelKey)}>
            {SEED_USERS.filter((u) => u.locale === g.locale).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.suburb})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
