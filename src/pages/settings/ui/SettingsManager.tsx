import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { LANGUAGES, THEMES } from "@/shared/config/preferences.ts";
import { LANGUAGE_NAMES, useMessages } from "@/shared/i18n/messages.ts";
import { PageHeader } from "@/shared/ui/PageHeader.tsx";
import { TooltipIconLink } from "@/shared/ui/TooltipIconButton.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/shadcn/card.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/shadcn/toggle-group.tsx";
import { VolumeControl } from "@/features/player/ui/VolumeControl.tsx";
import { useSettingsManager } from "@/pages/settings/model/use-settings-manager.ts";
import { SubtitlesCard } from "@/pages/settings/ui/SubtitlesCard.tsx";
import { TranslatorCard } from "@/pages/settings/ui/TranslatorCard.tsx";

const SWITCH = ["on", "off"] as const;

function SettingsManager() {
  const m = useMessages();
  const {
    language,
    setLanguage,
    theme,
    setTheme,
    keySounds,
    setKeySounds,
    environment,
    setEnvironment,
    shaders,
    setShaders,
    backToRadio,
  } = useSettingsManager();

  return (
    <>
      <PageHeader
        title={m.settings.title}
        onBack={backToRadio}
        backLabel={m.settings.backToRadio}
        action={
          <TooltipIconLink label={m.settings.about} to="/about">
            <Info />
          </TooltipIconLink>
        }
      />

      <div className="-m-1 flex min-h-0 flex-col items-center gap-4 overflow-y-auto p-1 scroll-fade">
        <SettingCard title={m.player.volume} description={m.settings.volumeDescription}>
          <VolumeControl className="w-full max-w-xs" />
        </SettingCard>

        <SettingCard title={m.settings.language} description={m.settings.languageDescription}>
          <Choices
            label={m.settings.language}
            options={LANGUAGES}
            value={language}
            onChange={setLanguage}
            render={(option) => <span lang={option}>{LANGUAGE_NAMES[option]}</span>}
          />
        </SettingCard>

        <SettingCard title={m.settings.theme} description={m.settings.themeDescription}>
          <Choices
            label={m.settings.theme}
            options={THEMES}
            value={theme}
            onChange={setTheme}
            render={(option) => m.settings.themeOptions[option]}
          />
        </SettingCard>

        <SettingCard title={m.settings.shaders} description={m.settings.shadersDescription}>
          <Switch label={m.settings.shaders} on={shaders} onChange={setShaders} />
        </SettingCard>

        <SettingCard title={m.settings.environment} description={m.settings.environmentDescription}>
          <Switch
            label={m.settings.environment}
            on={shaders && environment}
            onChange={setEnvironment}
            disabled={!shaders}
          />
        </SettingCard>

        <SubtitlesCard />

        <TranslatorCard />

        <SettingCard title={m.settings.keySounds} description={m.settings.keySoundsDescription}>
          <Switch label={m.settings.keySounds} on={keySounds} onChange={setKeySounds} />
        </SettingCard>
      </div>
    </>
  );
}

function SettingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="w-full max-w-2xl shrink-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Switch({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const m = useMessages();
  return (
    <Choices
      label={label}
      options={SWITCH}
      value={on ? "on" : "off"}
      onChange={(option) => onChange(option === "on")}
      render={(option) => m.settings.switchOptions[option]}
      disabled={disabled}
    />
  );
}

function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
  disabled,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (option: T) => ReactNode;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="outline"
      className="flex-wrap"
      value={[value]}
      disabled={disabled}
      // Pressing the chosen option again would leave nothing chosen.
      onValueChange={(next) => {
        const chosen = options.find((option) => option === next[0]);
        if (chosen) onChange(chosen);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option} className="px-3">
          {render(option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default SettingsManager;
