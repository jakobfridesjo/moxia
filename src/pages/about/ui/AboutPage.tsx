import { Link, useNavigate } from "@tanstack/react-router";
import { appVersion, buildTime } from "@/shared/config/env.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import type { Messages } from "@/shared/i18n/messages-en.ts";
import { formatShortDate } from "@/shared/lib/date.ts";
import { AppLogo } from "@/shared/ui/AppLogo.tsx";
import { PageHeader } from "@/shared/ui/PageHeader.tsx";
import { buttonVariants } from "@/shared/ui/shadcn/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/shadcn/card.tsx";

const AUTHOR = "Jakob Fridesjö";

const CREDITS: { role: keyof Messages["about"]["credits"]; name: string; license: string }[] = [
  { role: "stations", name: "radio-browser.info", license: "Public domain" },
  { role: "weather", name: "Open-Meteo.com", license: "CC BY 4.0" },
  { role: "decoding", name: "Symphonia", license: "MPL-2.0" },
  { role: "playback", name: "rodio", license: "MIT OR Apache-2.0" },
  { role: "transcription", name: "SenseVoice-Small", license: "FunASR Model License" },
  { role: "speechDetection", name: "FireRedVAD", license: "Apache-2.0" },
  { role: "translation", name: "opus-mt-zh-en (Helsinki-NLP)", license: "CC BY 4.0" },
  { role: "inference", name: "tract", license: "MIT OR Apache-2.0" },
  { role: "together", name: "iroh", license: "MIT OR Apache-2.0" },
];

function AboutPage() {
  const m = useMessages();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title={m.about.title} onBack={() => void navigate({ to: "/settings" })} />

      <div className="-m-1 flex min-h-0 flex-col items-center gap-4 overflow-y-auto p-1 scroll-fade">
        <Card className="w-full max-w-2xl shrink-0">
          <CardContent className="flex flex-col items-center gap-3 py-4 text-center">
            <AppLogo className="size-16" />
            <h2 className="text-2xl font-semibold">
              <span lang="zh">墨虾</span> Moxia
            </h2>
            <p className="text-muted-foreground">{m.about.tagline}</p>
            <p className="text-sm">{m.about.author(AUTHOR)}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {m.about.version(appVersion)}
              {buildTime !== "unknown" && ` · ${m.about.built(formatShortDate(buildTime))}`}
            </p>
          </CardContent>
        </Card>

        <Card className="w-full max-w-2xl shrink-0">
          <CardHeader>
            <CardTitle>{m.about.creditsTitle}</CardTitle>
            <CardDescription>{m.about.creditsDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y rounded-lg border">
              {CREDITS.map(({ role, name, license }) => (
                <div key={role} className="flex flex-wrap items-baseline gap-x-4 px-3 py-2">
                  <dt className="flex-1 text-muted-foreground">{m.about.credits[role]}</dt>
                  <dd className="font-medium">{name}</dd>
                  <dd className="w-28 text-right text-sm text-muted-foreground">{license}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="w-full max-w-2xl shrink-0">
          <CardHeader>
            <CardTitle>{m.about.licensesTitle}</CardTitle>
            <CardDescription>{m.about.licensesDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/about/licenses" className={buttonVariants({ variant: "outline" })}>
              {m.about.showLicenses}
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default AboutPage;
