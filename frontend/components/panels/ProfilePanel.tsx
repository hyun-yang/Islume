"use client";

import { useState } from "react";
import {
  useProfile,
  useUpdateProfile,
  useUpdateStatus,
  useModels,
} from "@/hooks/useProfile";
import { useT } from "@/lib/i18n";

export default function ProfilePanel() {
  const t = useT();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const updateStatus = useUpdateStatus();
  const { data: modelsData } = useModels();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{
    display_name: string;
    sex: string;
    age: string | number;
    job: string;
    suburb: string;
    find_radius_m: number;
  } | null>(null);

  if (isLoading || !profile) {
    return <div className="p-4 text-sm text-zinc-400">{t("profile.loadingProfile")}</div>;
  }

  const currentForm = form ?? {
    display_name: profile.display_name,
    sex: profile.sex ?? "",
    age: profile.age ?? "",
    job: profile.job ?? "",
    suburb: profile.suburb ?? "",
    find_radius_m: profile.find_radius_m,
  };

  const startEditing = () => {
    setForm({
      display_name: profile.display_name,
      sex: profile.sex ?? "",
      age: profile.age ?? "",
      job: profile.job ?? "",
      suburb: profile.suburb ?? "",
      find_radius_m: profile.find_radius_m,
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateProfile.mutate(
      {
        display_name: currentForm.display_name || undefined,
        sex: currentForm.sex || null,
        age: currentForm.age ? Number(currentForm.age) : null,
        job: currentForm.job || null,
        suburb: currentForm.suburb || null,
        find_radius_m: currentForm.find_radius_m,
      },
      {
        onSuccess: () => {
          setEditing(false);
          setForm(null);
        },
      },
    );
  };

  return (
    <div className="p-4 space-y-4">
      {/* Status toggles — always visible */}
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.is_active}
            onChange={(e) =>
              updateStatus.mutate({ is_active: e.target.checked })
            }
            className="rounded"
          />
          {t("profile.active")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.is_visible}
            onChange={(e) =>
              updateStatus.mutate({ is_visible: e.target.checked })
            }
            className="rounded"
          />
          {t("profile.visible")}
        </label>
        <span className="ml-auto text-xs px-2 py-0.5 rounded bg-zinc-100 text-zinc-600">
          {profile.tier}
        </span>
      </div>

      {/* Chat preferences — always visible */}
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.notification_enabled}
            onChange={(e) =>
              updateProfile.mutate({ notification_enabled: e.target.checked })
            }
            className="rounded"
          />
          {t("profile.notifications")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.chatting_enabled}
            onChange={(e) =>
              updateProfile.mutate({ chatting_enabled: e.target.checked })
            }
            className="rounded"
          />
          {t("profile.chatting")}
        </label>
      </div>

      {/* Profile fields */}
      {editing ? (
        <div className="space-y-3">
          <input
            className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
            placeholder={t("profile.name")}
            value={currentForm.display_name}
            onChange={(e) =>
              setForm({ ...currentForm, display_name: e.target.value })
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="px-3 py-1.5 border border-zinc-300 rounded text-sm"
              placeholder={t("profile.sex")}
              value={currentForm.sex}
              onChange={(e) => setForm({ ...currentForm, sex: e.target.value })}
            />
            <input
              className="px-3 py-1.5 border border-zinc-300 rounded text-sm"
              placeholder={t("profile.age")}
              type="number"
              value={currentForm.age}
              onChange={(e) => setForm({ ...currentForm, age: e.target.value })}
            />
          </div>
          <input
            className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
            placeholder={t("profile.job")}
            value={currentForm.job}
            onChange={(e) => setForm({ ...currentForm, job: e.target.value })}
          />
          <input
            className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
            placeholder={t("profile.suburb")}
            value={currentForm.suburb}
            onChange={(e) => setForm({ ...currentForm, suburb: e.target.value })}
          />
          <div>
            <label className="text-xs text-zinc-500">
              {t("profile.findRadius")}: {(currentForm.find_radius_m / 1000).toFixed(1)} km
            </label>
            <input
              type="range"
              min={500}
              max={100000}
              step={500}
              value={currentForm.find_radius_m}
              onChange={(e) =>
                setForm({ ...currentForm, find_radius_m: Number(e.target.value) })
              }
              className="w-full"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {updateProfile.isPending ? t("common.saving") : t("common.save")}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setForm(null);
              }}
              className="flex-1 py-1.5 bg-zinc-100 text-zinc-700 rounded text-sm hover:bg-zinc-200"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-medium">{profile.display_name}</div>
          <div className="text-xs text-zinc-500 space-y-1">
            {profile.sex && <div>{t("profile.sex")}: {profile.sex}</div>}
            {profile.age && <div>{t("profile.age")}: {profile.age}</div>}
            {profile.job && <div>{t("profile.job")}: {profile.job}</div>}
            {profile.suburb && <div>{t("profile.suburb")}: {profile.suburb}</div>}
            <div>{t("profile.findRadius")}: {(profile.find_radius_m / 1000).toFixed(1)} km</div>
          </div>
          {/* Model selector — always visible */}
          {modelsData && (
            <div>
              <label className="text-xs text-zinc-500">{t("profile.llmModel")}</label>
              <select
                className="w-full mt-1 px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                value={profile.preferred_model ?? ""}
                onChange={(e) =>
                  updateProfile.mutate({
                    preferred_model: e.target.value || null,
                  })
                }
              >
                <option value="">{t("profile.default")} ({modelsData.models[0]})</option>
                {modelsData.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={startEditing}
            className="w-full py-1.5 bg-zinc-100 text-zinc-700 rounded text-sm hover:bg-zinc-200"
          >
            {t("profile.editProfile")}
          </button>
          {/*
            Map editor entry is hidden while the platformer redesign lands;
            the editor still builds top-down maps that the new game won't
            consume. Will be reactivated once the editor speaks platformer.
          */}
        </div>
      )}
    </div>
  );
}
