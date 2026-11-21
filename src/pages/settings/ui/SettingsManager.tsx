import type { JSX } from "@solidjs/web";
import { Info } from "lucide";
import { LANGUAGES, THEMES } from "@/shared/config/preferences.ts";
import { LANGUAGE_NAMES, useMessages } from "@/shared/i18n/messages.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { PageHeader } from "@/shared/ui/PageHeader.tsx";
import { TooltipIconLink } from "@/shared/ui/TooltipIconButton.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/shadcn/card.tsx";
import { VolumeControl } from "@/features/player/ui/VolumeControl.tsx";
import { useSettingsManager } from "@/pages/settings/model/use-settings-manager.ts";
import { Choices } from "@/pages/settings/ui/Choices.tsx";
import { SubtitlesCard } from "@/pages/settings/ui/SubtitlesCard.tsx";
import { TranslatorCard } from "@/pages/settings/ui/TranslatorCard.tsx";

const SWITCH = ["on", "off"] as const;

function SettingsManager() {
  const m = useMessages();
  const settings = useSettingsManager();

  return (
    <>
      <PageHeader
        title={m.settings.title}
        onBack={settings.backToRadio}
        backLabel={m.settings.backToRadio}
        action={
          <TooltipIconLink label={m.settings.about} to="/about">
            <Icon icon={Info} />
          </TooltipIconLink>
        }
      />

      <div class="-m-1 flex min-h-0 flex-col items-center gap-4 overflow-y-auto p-1 scroll-fade">
        <SettingCard title={m.player.volume} description={m.settings.volumeDescription}>
          <VolumeControl class="w-full max-w-xs" />
        </SettingCard>

        <SettingCard title={m.settings.language} description={m.settings.languageDescription}>
          <Choices
            label={m.settings.language}
            class="flex-wrap"
            options={LANGUAGES}
            value={settings.language}
            onChange={settings.setLanguage}
            render={(option) => <span lang={option}>{LANGUAGE_NAMES[option]}</span>}
          />
        </SettingCard>

        <SettingCard title={m.settings.theme} description={m.settings.themeDescription}>
          <Choices
            label={m.settings.theme}
            class="flex-wrap"
            options={THEMES}
            value={settings.theme}
            onChange={settings.setTheme}
            render={(option) => m.settings.themeOptions[option]}
          />
        </SettingCard>

        <SettingCard title={m.settings.shaders} description={m.settings.shadersDescription}>
          <Switch label={m.settings.shaders} on={settings.shaders} onChange={settings.setShaders} />
        </SettingCard>

        <SettingCard title={m.settings.environment} description={m.settings.environmentDescription}>
          <Switch
            label={m.settings.environment}
            on={settings.shaders && settings.environment}
            onChange={settings.setEnvironment}
            disabled={!settings.shaders}
          />
        </SettingCard>

        <SubtitlesCard />

        <TranslatorCard />

        <SettingCard title={m.settings.keySounds} description={m.settings.keySoundsDescription}>
          <Switch
            label={m.settings.keySounds}
            on={settings.keySounds}
            onChange={settings.setKeySounds}
          />
        </SettingCard>
      </div>
    </>
  );
}

function SettingCard(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <Card class="w-full max-w-2xl shrink-0">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function Switch(props: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const m = useMessages();
  return (
    <Choices
      label={props.label}
      options={SWITCH}
      value={props.on ? "on" : "off"}
      onChange={(option) => props.onChange(option === "on")}
      render={(option) => m.settings.switchOptions[option]}
      disabled={props.disabled}
    />
  );
}

export default SettingsManager;
