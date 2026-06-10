"use client";

import { useEffect, useState } from "react";
import {
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useToggleAgent,
  useAgentMarkdown,
  useSaveAgentMarkdown,
} from "@/hooks/useAgents";
import type {
  AgentResponse,
  AgentTranslation,
  AttachedPlugin,
  Demographics,
  GoalCategory,
  InteractionMode,
  Preferences,
  RelationshipIntent,
  Sex,
} from "@/lib/types";
import { AGENT_TEMPLATES, getTemplate } from "@/lib/agentTemplates";
import AgentPluginsSection from "@/components/panels/AgentPluginsSection";
import { useT, useLocale } from "@/lib/i18n";

// Conversation language options for boundaries.language. A Korean choice plus
// the agent's persona translation is what makes agent↔agent chat run in Korean.
const CONVERSATION_LANGUAGES = ["en-AU", "en-US", "ko"];

const TONES = ["friendly", "warm", "enthusiastic", "playful", "serious", "flirty", "calm"];

const GOAL_CATEGORIES: GoalCategory[] = [
  "dating",
  "networking",
  "companionship",
  "collaboration",
  "casual_chat",
  "mentorship",
  "recruiting",
  "job_seeking",
];
const INTERACTION_MODES: InteractionMode[] = [
  "online_only",
  "offline_ok",
  "offline_preferred",
];
const RELATIONSHIP_INTENTS: RelationshipIntent[] = [
  "casual",
  "romantic",
  "professional",
  "friendship",
  "open",
];

const SEX_OPTIONS: Sex[] = ["male", "female", "nonbinary", "other"];

const EMPTY_FORM = {
  name: "",
  description: "",
  persona_prompt: "",
  tone: "friendly",
  tags: "",
  // v2
  goal: "",
  goal_category: "" as GoalCategory | "",
  interaction_mode: "" as InteractionMode | "",
  relationship_intent: "" as RelationshipIntent | "",
  compatible_intents: "" as string,
  topics_of_interest: "" as string,
};

const EMPTY_DEMOGRAPHICS = {
  height_cm: "",
  sex: "" as Sex | "",
  age: "",
  race: "",
  notes: "",
};

const EMPTY_PREFERENCES = {
  favorite_foods: "",
  favorite_movies: "",
  favorite_novels: "",
  life_view: "",
  religion_view: "",
  work_view: "",
};

const EMPTY_KO = {
  name: "",
  description: "",
  persona_prompt: "",
  tags: "",
};

function csvSplit(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

function koToForm(t?: AgentTranslation | null) {
  if (!t) return EMPTY_KO;
  return {
    name: t.name ?? "",
    description: t.description ?? "",
    persona_prompt: t.persona_prompt ?? "",
    tags: (t.tags ?? []).join(", "),
  };
}

function buildKoTranslation(f: typeof EMPTY_KO): AgentTranslation | null {
  const tags = csvSplit(f.tags);
  const out: AgentTranslation = {
    ...(f.name.trim() ? { name: f.name.trim() } : {}),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.persona_prompt.trim() ? { persona_prompt: f.persona_prompt.trim() } : {}),
    ...(tags.length ? { tags } : {}),
  };
  return Object.keys(out).length ? out : null;
}

function demographicsToForm(d?: Demographics | null) {
  if (!d) return EMPTY_DEMOGRAPHICS;
  return {
    height_cm: d.height_cm != null ? String(d.height_cm) : "",
    sex: (d.sex ?? "") as Sex | "",
    age: d.age != null ? String(d.age) : "",
    race: d.race ?? "",
    notes: d.notes ?? "",
  };
}

function preferencesToForm(p?: Preferences | null) {
  if (!p) return EMPTY_PREFERENCES;
  return {
    favorite_foods: (p.favorite_foods ?? []).join(", "),
    favorite_movies: (p.favorite_movies ?? []).join(", "),
    favorite_novels: (p.favorite_novels ?? []).join(", "),
    life_view: p.life_view ?? "",
    religion_view: p.religion_view ?? "",
    work_view: p.work_view ?? "",
  };
}

function buildDemographics(f: typeof EMPTY_DEMOGRAPHICS): Demographics | null {
  const height = f.height_cm.trim() ? Number(f.height_cm) : null;
  const age = f.age.trim() ? Number(f.age) : null;
  const out: Demographics = {
    height_cm: Number.isFinite(height) ? height : null,
    sex: f.sex || null,
    age: Number.isFinite(age) ? age : null,
    race: f.race.trim() || null,
    notes: f.notes.trim() || null,
  };
  const empty =
    out.height_cm == null &&
    !out.sex &&
    out.age == null &&
    !out.race &&
    !out.notes;
  return empty ? null : out;
}

function buildPreferences(f: typeof EMPTY_PREFERENCES): Preferences | null {
  const foods = csvSplit(f.favorite_foods);
  const movies = csvSplit(f.favorite_movies);
  const novels = csvSplit(f.favorite_novels);
  const out: Preferences = {
    favorite_foods: foods,
    favorite_movies: movies,
    favorite_novels: novels,
    life_view: f.life_view.trim() || null,
    religion_view: f.religion_view.trim() || null,
    work_view: f.work_view.trim() || null,
  };
  const empty =
    foods.length === 0 &&
    movies.length === 0 &&
    novels.length === 0 &&
    !out.life_view &&
    !out.religion_view &&
    !out.work_view;
  return empty ? null : out;
}

export default function AgentPanel() {
  const t = useT();
  const locale = useLocale();
  const { data: agents, isLoading } = useAgents();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const toggleAgent = useToggleAgent();

  const [showForm, setShowForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDemographics, setShowDemographics] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showKorean, setShowKorean] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentResponse | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [demographics, setDemographics] = useState(EMPTY_DEMOGRAPHICS);
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES);
  const [ko, setKo] = useState(EMPTY_KO);
  const [conversationLanguage, setConversationLanguage] = useState<string>("");
  const [attachedPlugins, setAttachedPlugins] = useState<AttachedPlugin[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [mdAgentId, setMdAgentId] = useState<string | null>(null);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setDemographics(EMPTY_DEMOGRAPHICS);
    setPreferences(EMPTY_PREFERENCES);
    setKo(EMPTY_KO);
    setConversationLanguage("");
    setAttachedPlugins([]);
    setShowForm(false);
    setShowAdvanced(false);
    setShowDemographics(false);
    setShowPreferences(false);
    setShowKorean(false);
    setEditingAgent(null);
    setTemplateId("");
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    if (!id) {
      setForm(EMPTY_FORM);
      setDemographics(EMPTY_DEMOGRAPHICS);
      setPreferences(EMPTY_PREFERENCES);
      return;
    }
    const tpl = getTemplate(id);
    if (!tpl) return;
    const d = tpl.defaults;
    setForm({
      name: d.name,
      description: d.description,
      persona_prompt: d.persona_prompt,
      tone: d.tone,
      tags: d.tags.join(", "),
      goal: d.goal ?? "",
      goal_category: (d.goal_category as GoalCategory) ?? "",
      interaction_mode: (d.interaction_mode as InteractionMode) ?? "",
      relationship_intent: (d.relationship_intent as RelationshipIntent) ?? "",
      compatible_intents: (d.compatible_intents ?? []).join(", "),
      topics_of_interest: (d.topics_of_interest ?? []).join(", "),
    });
    const dm = demographicsToForm(d.demographics);
    const pr = preferencesToForm(d.preferences);
    setDemographics(dm);
    setPreferences(pr);
    setShowAdvanced(
      Boolean(
        d.goal ||
          d.goal_category ||
          d.interaction_mode ||
          d.relationship_intent ||
          (d.compatible_intents?.length ?? 0) > 0 ||
          (d.topics_of_interest?.length ?? 0) > 0,
      ),
    );
    setShowDemographics(dm !== EMPTY_DEMOGRAPHICS);
    setShowPreferences(pr !== EMPTY_PREFERENCES);
  };

  const startEdit = (agent: AgentResponse) => {
    setForm({
      name: agent.name,
      description: agent.description,
      persona_prompt: agent.persona_prompt,
      tone: agent.tone,
      tags: agent.tags.join(", "),
      goal: agent.goal ?? "",
      goal_category: (agent.goal_category as GoalCategory) ?? "",
      interaction_mode: (agent.interaction_mode as InteractionMode) ?? "",
      relationship_intent: (agent.relationship_intent as RelationshipIntent) ?? "",
      compatible_intents: (agent.compatible_intents ?? []).join(", "),
      topics_of_interest: (agent.topics_of_interest ?? []).join(", "),
    });
    const dm = demographicsToForm(agent.demographics);
    const pr = preferencesToForm(agent.preferences);
    const koForm = koToForm(agent.translations?.ko);
    setDemographics(dm);
    setPreferences(pr);
    setKo(koForm);
    setConversationLanguage(
      typeof agent.boundaries?.language === "string" ? agent.boundaries.language : "",
    );
    setShowKorean(koForm !== EMPTY_KO);
    setEditingAgent(agent);
    setShowForm(true);
    setShowAdvanced(
      Boolean(
        agent.goal ||
          agent.goal_category ||
          agent.interaction_mode ||
          agent.relationship_intent ||
          (agent.compatible_intents?.length ?? 0) > 0 ||
          (agent.topics_of_interest?.length ?? 0) > 0,
      ),
    );
    setShowDemographics(Boolean(agent.demographics));
    setShowPreferences(Boolean(agent.preferences));
    setAttachedPlugins(agent.attached_plugins ?? []);
    setTemplateId("");
  };

  const handleSubmit = () => {
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const compatible = form.compatible_intents
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean) as RelationshipIntent[];
    const topics = form.topics_of_interest
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const v2 = {
      ...(form.goal ? { goal: form.goal } : {}),
      ...(form.goal_category ? { goal_category: form.goal_category as GoalCategory } : {}),
      ...(form.interaction_mode ? { interaction_mode: form.interaction_mode as InteractionMode } : {}),
      ...(form.relationship_intent ? { relationship_intent: form.relationship_intent as RelationshipIntent } : {}),
      ...(compatible.length ? { compatible_intents: compatible } : {}),
      ...(topics.length ? { topics_of_interest: topics } : {}),
    };

    const dem = buildDemographics(demographics);
    const pref = buildPreferences(preferences);
    const koTr = buildKoTranslation(ko);

    const base = {
      name: form.name,
      description: form.description,
      persona_prompt: form.persona_prompt,
      tone: form.tone,
      tags,
    };

    // Merge the language choice into existing boundaries so we don't clobber
    // avoid_topics/formality/etc. Only sent when a language is selected.
    const boundaries = conversationLanguage
      ? { ...(editingAgent?.boundaries ?? {}), language: conversationLanguage }
      : undefined;

    const payload = {
      ...base,
      ...v2,
      demographics: dem,
      preferences: pref,
      attached_plugins: attachedPlugins.length > 0 ? attachedPlugins : null,
      translations: koTr ? { ko: koTr } : null,
      ...(boundaries ? { boundaries } : {}),
    };

    if (editingAgent) {
      updateAgent.mutate(
        { agentId: editingAgent.id, data: payload },
        { onSuccess: resetForm },
      );
    } else {
      createAgent.mutate(payload, { onSuccess: resetForm });
    }
  };

  if (isLoading) {
    return <div className="p-4 text-sm text-zinc-400">{t("common.loading")}</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{t("agent.myAgents")}</span>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="text-xs text-emerald-600 hover:text-emerald-700"
          >
            {t("agent.newShort")}
          </button>
        )}
      </div>

      {/* Agent cards */}
      {agents?.map((agent) => (
        <div
          key={agent.id}
          className="border border-zinc-200 rounded-lg p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {(locale === "ko" && agent.translations?.ko?.name) || agent.name}
            </span>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={agent.is_active}
                onChange={() => toggleAgent.mutate(agent.id)}
                className="rounded"
              />
              {t("agent.active")}
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {((locale === "ko" && agent.translations?.ko?.tags?.length
              ? agent.translations.ko.tags
              : agent.tags)).map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => startEdit(agent)}
              className="text-xs text-zinc-500 hover:text-zinc-700"
            >
              {t("common.edit")}
            </button>
            <button
              onClick={() => setMdAgentId(agent.id)}
              className="text-xs text-indigo-500 hover:text-indigo-700"
              title={t("agent.editRawMd")}
            >
              📝 {t("agent.editMd")}
            </button>
            <button
              onClick={() => {
                if (confirm(`${t("agent.deleteConfirm")} "${agent.name}"?`)) {
                  deleteAgent.mutate(agent.id);
                }
              }}
              className="text-xs text-red-500 hover:text-red-700"
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      ))}

      {mdAgentId && (
        <MarkdownEditorModal
          agentId={mdAgentId}
          onClose={() => setMdAgentId(null)}
        />
      )}

      {/* Create/Edit form */}
      {showForm && (
        <div className="border border-emerald-200 rounded-lg p-3 space-y-2 bg-emerald-50/50">
          <div className="text-xs font-medium text-emerald-700">
            {editingAgent ? t("agent.editAgent") : t("agent.newAgent")}
          </div>

          {/* Template picker — create flow only */}
          {!editingAgent && (
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">{t("agent.startFromTemplate")}</label>
              <select
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">{t("agent.startFromScratch")}</option>
                {AGENT_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.description}
                  </option>
                ))}
              </select>
              {templateId && (
                <p className="text-xs text-zinc-500">
                  {t("agent.templateEditHint")}
                </p>
              )}
            </div>
          )}

          <input
            className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
            placeholder={t("agent.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
            placeholder={t("agent.description")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <textarea
            className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm h-20 resize-none"
            placeholder={t("agent.personaPlaceholder")}
            value={form.persona_prompt}
            onChange={(e) => setForm({ ...form, persona_prompt: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className="px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              className="px-3 py-1.5 border border-zinc-300 rounded text-sm"
              placeholder={t("agent.tagsPlaceholder")}
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-700 self-start"
          >
            {showAdvanced ? `▼ ${t("agent.advancedV2")}` : `▶ ${t("agent.advancedV2")}`}
          </button>

          {showAdvanced && (
            <div className="space-y-2 border-t border-zinc-200 pt-2">
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.goalPlaceholder")}
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                  value={form.goal_category}
                  onChange={(e) =>
                    setForm({ ...form, goal_category: e.target.value as GoalCategory | "" })
                  }
                >
                  <option value="">{t("agent.goalCategoryPlaceholder")}</option>
                  {GOAL_CATEGORIES.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <select
                  className="px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                  value={form.interaction_mode}
                  onChange={(e) =>
                    setForm({ ...form, interaction_mode: e.target.value as InteractionMode | "" })
                  }
                >
                  <option value="">{t("agent.interactionModePlaceholder")}</option>
                  {INTERACTION_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <select
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                value={form.relationship_intent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    relationship_intent: e.target.value as RelationshipIntent | "",
                  })
                }
              >
                <option value="">{t("agent.relationshipIntentPlaceholder")}</option>
                {RELATIONSHIP_INTENTS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.compatibleIntentsPlaceholder")}
                value={form.compatible_intents}
                onChange={(e) => setForm({ ...form, compatible_intents: e.target.value })}
              />
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.topicsPlaceholder")}
                value={form.topics_of_interest}
                onChange={(e) => setForm({ ...form, topics_of_interest: e.target.value })}
              />
              <label className="block text-xs text-zinc-500">
                {t("agent.conversationLanguage")}
              </label>
              <select
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                value={conversationLanguage}
                onChange={(e) => setConversationLanguage(e.target.value)}
              >
                <option value="">{t("agent.keepCurrent")}</option>
                {CONVERSATION_LANGUAGES.map((lng) => (
                  <option key={lng} value={lng}>{lng}</option>
                ))}
              </select>
            </div>
          )}

          {/* Demographics — optional */}
          <button
            type="button"
            onClick={() => setShowDemographics((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-700 self-start"
          >
            {showDemographics ? `▼ ${t("agent.demographics")}` : `▶ ${t("agent.demographics")}`}
          </button>
          {showDemographics && (
            <div className="space-y-2 border-t border-zinc-200 pt-2">
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  className="px-3 py-1.5 border border-zinc-300 rounded text-sm"
                  placeholder={t("agent.heightCm")}
                  value={demographics.height_cm}
                  onChange={(e) =>
                    setDemographics({ ...demographics, height_cm: e.target.value })
                  }
                />
                <input
                  type="number"
                  className="px-3 py-1.5 border border-zinc-300 rounded text-sm"
                  placeholder={t("agent.age")}
                  value={demographics.age}
                  onChange={(e) => setDemographics({ ...demographics, age: e.target.value })}
                />
                <select
                  className="px-3 py-1.5 border border-zinc-300 rounded text-sm bg-white"
                  value={demographics.sex}
                  onChange={(e) =>
                    setDemographics({ ...demographics, sex: e.target.value as Sex | "" })
                  }
                >
                  <option value="">{t("agent.sexPlaceholder")}</option>
                  {SEX_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.racePlaceholder")}
                value={demographics.race}
                onChange={(e) => setDemographics({ ...demographics, race: e.target.value })}
              />
              <textarea
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm h-14 resize-none"
                placeholder={t("agent.notesPlaceholder")}
                value={demographics.notes}
                onChange={(e) => setDemographics({ ...demographics, notes: e.target.value })}
              />
            </div>
          )}

          {/* Preferences — optional */}
          <button
            type="button"
            onClick={() => setShowPreferences((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-700 self-start"
          >
            {showPreferences ? `▼ ${t("agent.preferences")}` : `▶ ${t("agent.preferences")}`}
          </button>
          {showPreferences && (
            <div className="space-y-2 border-t border-zinc-200 pt-2">
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.favoriteFoods")}
                value={preferences.favorite_foods}
                onChange={(e) =>
                  setPreferences({ ...preferences, favorite_foods: e.target.value })
                }
              />
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.favoriteMovies")}
                value={preferences.favorite_movies}
                onChange={(e) =>
                  setPreferences({ ...preferences, favorite_movies: e.target.value })
                }
              />
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.favoriteNovels")}
                value={preferences.favorite_novels}
                onChange={(e) =>
                  setPreferences({ ...preferences, favorite_novels: e.target.value })
                }
              />
              <textarea
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm h-14 resize-none"
                placeholder={t("agent.lifeView")}
                value={preferences.life_view}
                onChange={(e) =>
                  setPreferences({ ...preferences, life_view: e.target.value })
                }
              />
              <textarea
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm h-14 resize-none"
                placeholder={t("agent.religionView")}
                value={preferences.religion_view}
                onChange={(e) =>
                  setPreferences({ ...preferences, religion_view: e.target.value })
                }
              />
              <textarea
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm h-14 resize-none"
                placeholder={t("agent.workView")}
                value={preferences.work_view}
                onChange={(e) =>
                  setPreferences({ ...preferences, work_view: e.target.value })
                }
              />
            </div>
          )}

          {/* Korean persona — optional. Filled in, plus conversation
              language = ko, makes agent↔agent chat run in Korean. */}
          <button
            type="button"
            onClick={() => setShowKorean((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-700 self-start"
          >
            {showKorean ? `▼ ${t("agent.korean")}` : `▶ ${t("agent.korean")}`}
          </button>
          {showKorean && (
            <div className="space-y-2 border-t border-zinc-200 pt-2">
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.koName")}
                value={ko.name}
                onChange={(e) => setKo({ ...ko, name: e.target.value })}
              />
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={t("agent.koDescription")}
                value={ko.description}
                onChange={(e) => setKo({ ...ko, description: e.target.value })}
              />
              <textarea
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm h-20 resize-none"
                placeholder={t("agent.koPersona")}
                value={ko.persona_prompt}
                onChange={(e) => setKo({ ...ko, persona_prompt: e.target.value })}
              />
              <input
                className="w-full px-3 py-1.5 border border-zinc-300 rounded text-sm"
                placeholder={`${t("agent.koTags")} (${t("agent.tagsHint")})`}
                value={ko.tags}
                onChange={(e) => setKo({ ...ko, tags: e.target.value })}
              />
            </div>
          )}

          <AgentPluginsSection
            value={attachedPlugins}
            onChange={setAttachedPlugins}
          />

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!form.name || !form.persona_prompt || createAgent.isPending || updateAgent.isPending}
              className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {editingAgent ? t("agent.update") : t("agent.create")}
            </button>
            <button
              onClick={resetForm}
              className="flex-1 py-1.5 bg-zinc-100 text-zinc-700 rounded text-sm hover:bg-zinc-200"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MarkdownEditorModal({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { data, isLoading, error: loadError } = useAgentMarkdown(agentId);
  const save = useSaveAgentMarkdown();
  const [draft, setDraft] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.markdown !== undefined) {
      setDraft(data.markdown);
      setOriginal(data.markdown);
    }
  }, [data?.markdown]);

  const dirty = draft !== original;

  const handleSave = () => {
    setServerError(null);
    save.mutate(
      { agentId, markdown: draft },
      {
        onSuccess: (resp) => {
          setDraft(resp.markdown);
          setOriginal(resp.markdown);
          onClose();
        },
        onError: (err) => {
          setServerError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const handleCancel = () => {
    if (dirty && !confirm(t("agent.discardMdConfirm"))) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleCancel}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-[min(900px,92vw)] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200">
          <span className="text-sm font-medium">
            {t("agent.editAgentMarkdown")}
            {data?.revision !== undefined && (
              <span className="ml-2 text-xs text-zinc-500">{t("agent.revShort")} {data.revision}</span>
            )}
          </span>
          <button onClick={handleCancel} className="text-zinc-500 hover:text-zinc-800">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
          {isLoading && <div className="text-sm text-zinc-500">{t("common.loading")}</div>}
          {loadError && (
            <div className="text-sm text-red-600 whitespace-pre-wrap">
              {loadError instanceof Error ? loadError.message : String(loadError)}
            </div>
          )}
          {!isLoading && !loadError && (
            <textarea
              className="w-full h-[60vh] px-3 py-2 border border-zinc-300 rounded font-mono text-xs leading-relaxed resize-none"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          {serverError && (
            <div className="border border-red-300 bg-red-50 text-red-700 rounded px-3 py-2 text-xs whitespace-pre-wrap">
              {serverError}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-4 py-2 border-t border-zinc-200">
          <button
            onClick={handleSave}
            disabled={!dirty || save.isPending || isLoading}
            className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 py-1.5 bg-zinc-100 text-zinc-700 rounded text-sm hover:bg-zinc-200"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
