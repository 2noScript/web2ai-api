import { useState, type FormEvent } from "react";
import { Check, Edit2, ImagePlus, PawPrint, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  PET_CATALOG,
  PetSprite,
  type PetId,
  type PetStatus,
} from "@/components/pet-sprite";
import {
  SKILL_PRESETS,
  useCustomPets,
  type CustomPet,
  type SkillPresetId,
} from "@/hooks/use-custom-pets";

const PREVIEW_STATUSES: PetStatus[] = [
  "idle",
  "happy",
  "wink",
  "shy",
  "annoyed",
  "typing",
  "thinking",
  "waiting",
  "streaming",
  "done",
  "error",
];

interface PetStoreTabProps {
  selectedPetId: string;
  previewPetStatus: PetStatus;
  onPreviewStatusChange: (status: PetStatus) => void;
  onSelectPet: (petId: string) => void;
  onSummonPet: () => void;
  onTogglePetWindow: () => void;
  petReactTraffic: boolean;
  onToggleReactTraffic: (enabled: boolean) => void;
}

export function PetStoreTab({
  selectedPetId,
  previewPetStatus,
  onPreviewStatusChange,
  onSelectPet,
  onSummonPet,
  onTogglePetWindow,
  petReactTraffic,
  onToggleReactTraffic,
}: PetStoreTabProps) {
  const { customPets, upsertCustomPet, deleteCustomPet } = useCustomPets();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<CustomPet | null>(null);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [uiSprite, setUiSprite] = useState<PetId>("fox");
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | undefined>(undefined);
  const [skillPreset, setSkillPreset] = useState<SkillPresetId>("reviewer");
  const [systemPrompt, setSystemPrompt] = useState(SKILL_PRESETS[0].prompt);
  const [defaultModel, setDefaultModel] = useState("deepseek:deepseek-chat");

  const openAddModal = () => {
    setEditingPet(null);
    setName("");
    setTagline("");
    setUiSprite("fox");
    setCustomAvatarUrl(undefined);
    setSkillPreset("reviewer");
    setSystemPrompt(SKILL_PRESETS[0].prompt);
    setDefaultModel("deepseek:deepseek-chat");
    setModalOpen(true);
  };

  const openEditModal = (pet: CustomPet) => {
    setEditingPet(pet);
    setName(pet.name);
    setTagline(pet.tagline);
    setUiSprite(pet.uiSprite);
    setCustomAvatarUrl(pet.customAvatarUrl);
    setSkillPreset(pet.skillPreset);
    setSystemPrompt(pet.systemPrompt);
    setDefaultModel(pet.defaultModel || "deepseek:deepseek-chat");
    setModalOpen(true);
  };

  const handleSaveCustomPet = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const next: CustomPet = {
      id: editingPet?.id ?? `custom-${Date.now().toString(36)}`,
      name: trimmedName,
      tagline: tagline.trim() || SKILL_PRESETS.find((s) => s.id === skillPreset)?.label || "Custom Skill",
      uiSprite,
      customAvatarUrl,
      skillPreset,
      systemPrompt: systemPrompt.trim() || SKILL_PRESETS[0].prompt,
      defaultModel,
    };
    await upsertCustomPet(next);
    setModalOpen(false);
    if (!editingPet) {
      onSelectPet(next.id);
    }
  };

  const handleDeleteCustom = async (pet: CustomPet) => {
    await deleteCustomPet(pet.id);
    if (selectedPetId === pet.id) {
      onSelectPet("fox");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Pet Store</h2>
          <p className="text-xs text-muted-foreground">
            Built-in &amp; custom pets with skills. Shortcuts:{" "}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">
              ⌘⇧Space
            </code>{" "}
            Quick Chat ·{" "}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">
              ⌘⇧P
            </code>{" "}
            Summon
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[11px]">
            {PREVIEW_STATUSES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onPreviewStatusChange(st)}
                className={`rounded px-2 py-1 capitalize transition-colors ${
                  previewPetStatus === st
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <Button variant="default" size="sm" className="h-7 gap-1 text-xs" onClick={openAddModal}>
            <Plus className="h-3.5 w-3.5" />
            Add Pet
          </Button>
          <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-xs" onClick={onSummonPet}>
            <PawPrint className="h-3.5 w-3.5" />
            Bring Pet
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={onTogglePetWindow}
          >
            Show / Hide
          </Button>
          <label className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[11px] text-muted-foreground">
            <span>React to Traffic</span>
            <Switch
              size="sm"
              checked={petReactTraffic}
              onCheckedChange={onToggleReactTraffic}
            />
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {/* Custom User Pets */}
        {customPets.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              My Custom Pets ({customPets.length})
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
              {customPets.map((pet) => {
                const isEquipped = selectedPetId === pet.id;
                const skillLabel =
                  SKILL_PRESETS.find((s) => s.id === pet.skillPreset)?.label ?? "Custom";
                return (
                  <Card
                    key={pet.id}
                    className={`flex flex-col justify-between py-3 transition-colors ${
                      isEquipped ? "border-primary/70 bg-primary/5" : "hover:border-border/80"
                    }`}
                  >
                    <CardHeader className="px-3 pt-0 pb-1.5">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <CardTitle className="truncate text-xs font-semibold">{pet.name}</CardTitle>
                          <CardDescription className="truncate text-[10px]">
                            {skillLabel}
                          </CardDescription>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(pet)}
                            title="Edit Custom Pet"
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCustom(pet)}
                            title="Delete Custom Pet"
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center gap-2 px-3 pt-0 pb-0">
                      <button
                        type="button"
                        onClick={() => onSelectPet(pet.id)}
                        title="Click to equip this pet"
                        className="flex h-20 w-full cursor-pointer items-center justify-center rounded-lg border border-border/60 bg-secondary/40 transition-colors hover:border-primary/60 hover:bg-secondary/70"
                      >
                        <PetSprite
                          petId={pet.uiSprite}
                          status={previewPetStatus}
                          size="md"
                          customAvatarUrl={pet.customAvatarUrl}
                        />
                      </button>
                      <p className="line-clamp-1 text-center text-[11px] text-muted-foreground">
                        {pet.tagline}
                      </p>
                      <Button
                        size="sm"
                        variant={isEquipped ? "secondary" : "default"}
                        disabled={isEquipped}
                        className="h-6 w-full text-[11px]"
                        onClick={() => onSelectPet(pet.id)}
                      >
                        {isEquipped ? "Equipped" : "Equip Pet"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Built-in Pets */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Built-in Pets ({PET_CATALOG.length})
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
            {PET_CATALOG.map((pet) => {
              const isEquipped = selectedPetId === pet.id;
              return (
                <Card
                  key={pet.id}
                  className={`flex flex-col justify-between py-3 transition-colors ${
                    isEquipped ? "border-primary/70 bg-primary/5" : "hover:border-border/80"
                  }`}
                >
                  <CardHeader className="px-3 pt-0 pb-1.5">
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-xs font-semibold">{pet.name}</CardTitle>
                        <CardDescription className="truncate text-[10px]">{pet.badge}</CardDescription>
                      </div>
                      {isEquipped && (
                        <Badge variant="default" className="h-4 shrink-0 gap-0.5 px-1.5 text-[9px]">
                          <Check className="h-2.5 w-2.5" />
                          Equipped
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col items-center gap-2 px-3 pt-0 pb-0">
                    <button
                      type="button"
                      onClick={() => onSelectPet(pet.id)}
                      title="Click to equip this pet"
                      className="flex h-20 w-full cursor-pointer items-center justify-center rounded-lg border border-border/60 bg-secondary/40 transition-colors hover:border-primary/60 hover:bg-secondary/70"
                    >
                      <PetSprite petId={pet.id} status={previewPetStatus} size="md" />
                    </button>
                    <p className="line-clamp-1 text-center text-[11px] text-muted-foreground">
                      {pet.tagline}
                    </p>
                    <Button
                      size="sm"
                      variant={isEquipped ? "secondary" : "default"}
                      disabled={isEquipped}
                      className="h-6 w-full text-[11px]"
                      onClick={() => onSelectPet(pet.id)}
                    >
                      {isEquipped ? "Equipped" : "Equip Pet"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create / Edit Custom Pet Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm">
                  {editingPet ? "Edit Custom Pet" : "Create Custom Pet"}
                </CardTitle>
                <CardDescription className="text-xs">
                  Choose a UI look, skill preset, and custom system prompt.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => setModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleSaveCustomPet(e)} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Pet Name
                    </label>
                    <Input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Code Reviewer"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Short Tagline
                    </label>
                    <Input
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="e.g. Fast Rust & TS review"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Choose Pet UI
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-primary hover:underline">
                      <ImagePlus className="h-3 w-3" />
                      <span>{customAvatarUrl ? "Change image" : "Upload custom image"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === "string") {
                              setCustomAvatarUrl(reader.result);
                            }
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {PET_CATALOG.map((p) => {
                      const active = !customAvatarUrl && uiSprite === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setCustomAvatarUrl(undefined);
                            setUiSprite(p.id);
                          }}
                          className={`flex h-14 flex-col items-center justify-center rounded-lg border transition-colors ${
                            active
                              ? "border-primary bg-primary/15"
                              : "border-border bg-secondary/40 hover:border-primary/50"
                          }`}
                        >
                          <div className="scale-[0.65]">
                            <PetSprite petId={p.id} status="idle" size="sm" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {customAvatarUrl && (
                    <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs">
                      <img
                        src={customAvatarUrl}
                        alt="Custom preview"
                        className="h-8 w-8 rounded object-contain"
                      />
                      <span className="flex-1 truncate text-[11px] text-muted-foreground">
                        Custom avatar image selected
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setCustomAvatarUrl(undefined)}
                      >
                        Reset
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Skill Preset
                    </label>
                    <select
                      value={skillPreset}
                      onChange={(e) => {
                        const next = e.target.value as SkillPresetId;
                        setSkillPreset(next);
                        const preset = SKILL_PRESETS.find((s) => s.id === next);
                        if (preset) setSystemPrompt(preset.prompt);
                      }}
                      className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none"
                    >
                      {SKILL_PRESETS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Default Model
                    </label>
                    <select
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none"
                    >
                      <option value="deepseek:deepseek-chat">deepseek-chat</option>
                      <option value="deepseek:deepseek-reasoner">deepseek-reasoner</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Custom Skill / System Prompt
                  </label>
                  <Textarea
                    rows={3}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Describe how this pet should behave and what skill it specializes in..."
                    className="text-xs"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm">
                    {editingPet ? "Save Changes" : "Create & Equip"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
