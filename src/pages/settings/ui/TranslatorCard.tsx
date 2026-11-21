import { useMessages } from "@/shared/i18n/messages.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/shadcn/card.tsx";
import { useModelSettings } from "@/pages/settings/model/use-model-settings.ts";
import { ModelSection } from "@/pages/settings/ui/ModelSection.tsx";

/** The translator chat messages are put into English with: downloading and deleting it. */
export function TranslatorCard() {
  const m = useMessages();
  const translator = useModelSettings("translator");

  return (
    <Card class="w-full max-w-2xl shrink-0">
      <CardHeader>
        <CardTitle>{m.translator.title}</CardTitle>
        <CardDescription>{m.translator.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ModelSection
          name={m.translator.modelName}
          sources={m.translator.sources}
          uses={m.translator.uses}
          settings={translator}
        />
      </CardContent>
    </Card>
  );
}
