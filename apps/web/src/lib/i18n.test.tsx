// Interface language: browser default, server preference, explicit choice, and
// the translated/fallback rendering that each of those produces.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, useI18n } from "./i18n";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const auth = { me: null as { locale?: string | null } | null, token: "t" as string | null };
vi.mock("./auth", () => ({ useAuth: () => auth }));

function Probe() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="translated">{t("New chat")}</p>
      <p data-testid="fallback">{t("A sentence nobody translated")}</p>
      <p data-testid="vars">{t("Download all {count} images", { count: 3 })}</p>
      <button type="button" onClick={() => setLocale("zh")}>
        switch
      </button>
    </div>
  );
}

function setBrowser(languages: string[], language = languages[0] ?? "en-US") {
  Object.defineProperty(window.navigator, "languages", { value: languages, configurable: true });
  Object.defineProperty(window.navigator, "language", { value: language, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.lang = "";
  auth.me = null;
  setBrowser(["en-US"]);
});

describe("interface language", () => {
  it("defaults to the browser's language", () => {
    setBrowser(["hi-IN", "en-US"]);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("hi");
    expect(screen.getByTestId("translated")).toHaveTextContent("नई चैट");
    expect(document.documentElement.lang).toBe("hi");
  });

  it("falls back to English for an unsupported browser language", () => {
    setBrowser(["de-DE"]);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("translated")).toHaveTextContent("New chat");
  });

  it("prefers the saved profile preference over the browser", () => {
    setBrowser(["hi-IN"]);
    auth.me = { locale: "zh" };
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("zh");
    expect(screen.getByTestId("translated")).toHaveTextContent("新对话");
  });

  it("keeps an untranslated sentence readable in English", () => {
    setBrowser(["zh-CN"]);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("fallback")).toHaveTextContent("A sentence nobody translated");
  });

  it("substitutes variables into a translated sentence", () => {
    setBrowser(["en-US"]);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("vars")).toHaveTextContent("Download all 3 images");
  });

  it("persists a new choice locally and on the server", async () => {
    setBrowser(["en-US"]);
    const fetchMock = installFetchMock({ "/api/me": jsonResponse(200, { id: "u1" }) });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByTestId("locale")).toHaveTextContent("zh");
    expect(window.localStorage.getItem("lore.locale")).toBe("zh");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({ locale: "zh" });
  });

  it("remembers the explicit choice on the next visit", () => {
    setBrowser(["hi-IN"]);
    window.localStorage.setItem("lore.locale", "zh");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("zh");
  });
});
