// Theme: the choice is written to the document, remembered locally for the next
// paint, and pushed to the profile when a session exists.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./theme";

function Probe() {
  const { theme, resolved, neon, setTheme, setNeon } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme("dark")}>Night</button>
      <button onClick={() => setTheme("light")}>Day</button>
      <button onClick={() => setNeon(true)}>Neon on</button>
      <span data-testid="neon">{String(neon)}</span>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.neon;
  window.localStorage.clear();
});

describe("ThemeProvider", () => {
  it("applies the chosen theme to the document and remembers it", async () => {
    render(
      <ThemeProvider token={null}>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("lore.theme")).toBe("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("turns the neon layer on independently of the theme", async () => {
    render(
      <ThemeProvider token={null}>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.neon).toBe("off");
    await userEvent.click(screen.getByRole("button", { name: "Neon on" }));
    expect(document.documentElement.dataset.neon).toBe("on");
    expect(window.localStorage.getItem("lore.neon")).toBe("on");
    expect(screen.getByTestId("neon")).toHaveTextContent("true");
  });
  it("uses a stored choice on the next visit", () => {
    window.localStorage.setItem("lore.theme", "light");
    render(
      <ThemeProvider token={null}>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});