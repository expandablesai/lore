// Chat keyboard behaviour: Enter sends, Shift+Enter writes a new line, and an
// in-progress IME composition is never cut short by the Enter that commits it.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { Chat } from "./Chat";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

// The view reads the signed-in profile from AuthProvider (for the avatar).
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user,
    me: { ...user, status: "active", hasAvatar: false },
    token: "t",
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    refreshMe: vi.fn(async () => {}),
    logout: vi.fn(),
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function reply(content = "Chen Lian is Li Wei's mother.") {
  return jsonResponse(200, { message: { role: "assistant", content } });
}

describe("Chat", () => {
  it("sends the draft when Enter is pressed", async () => {
    const fetchMock = installFetchMock({ "/api/chat": reply() });
    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    const box = screen.getByLabelText("Message");

    await userEvent.type(box, "who is Li Wei's mother?{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.messages).toEqual([{ role: "user", content: "who is Li Wei's mother?" }]);
    await waitFor(() => expect(screen.getByText(/Chen Lian/)).toBeInTheDocument());
    expect(box).toHaveValue("");
  });

  it("inserts a new line on Shift+Enter without sending", async () => {
    const fetchMock = installFetchMock({ "/api/chat": reply() });
    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    const box = screen.getByLabelText("Message");

    await userEvent.type(box, "episode 3{Shift>}{Enter}{/Shift}explain everything");

    expect(box).toHaveValue("episode 3\nexplain everything");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send the Enter that commits an IME candidate", async () => {
    const fetchMock = installFetchMock({ "/api/chat": reply() });
    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    const box = screen.getByLabelText("Message");

    await userEvent.type(box, "陈莲");
    // While composing, the browser marks the keydown; this Enter belongs to the
    // input method, not to the chat box.
    fireEvent.keyDown(box, { key: "Enter", code: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter", keyCode: 229 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(box).toHaveValue("陈莲");
  });

  it("does nothing on Enter when the draft is empty", async () => {
    const fetchMock = installFetchMock({ "/api/chat": reply() });
    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    const box = screen.getByLabelText("Message");

    await userEvent.type(box, "   {Enter}");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Chat images", () => {
  // jsdom ships neither function, and the component revokes its object URLs
  // during cleanup — after this file would have restored the originals.
  beforeAll(() => {
    URL.createObjectURL = () => "blob:mock-url";
    URL.revokeObjectURL = () => {};
  });

  it("shows the image a reply was grounded on", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              message: { role: "assistant", content: "Here is the portfolio." },
              images: [{ documentId: "d1", filename: "portfolio.png", mime: "image/png" }],
            }),
        } as Response;
      }
      if (url.includes("/api/documents/d1/blob")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          blob: async () => new Blob(["png"], { type: "image/png" }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "show me the portfolio{Enter}");

    await waitFor(() => expect(screen.getByAltText("portfolio.png")).toBeInTheDocument());
    expect(screen.getByAltText("portfolio.png")).toHaveAttribute("src", "blob:mock-url");
    expect(screen.getByText("Here is the portfolio.")).toBeInTheDocument();
  });

  it("drops markdown image links from the reply text", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              message: {
                role: "assistant",
                content: "Here is the check image:\n\n![vision-check.png](vision-check.png)",
              },
              images: [{ documentId: "d1", filename: "vision-check.png", mime: "image/png" }],
            }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        blob: async () => new Blob(["png"], { type: "image/png" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "show me the check image{Enter}");

    await waitFor(() => expect(screen.getByAltText("vision-check.png")).toBeInTheDocument());
    expect(screen.getByText("Here is the check image:")).toBeInTheDocument();
    expect(screen.queryByText(/!\[/)).not.toBeInTheDocument();
  });

  it("opens the picture full screen, with a download, when clicked", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        return {
          ok: true, status: 200, statusText: "OK",
          text: async () =>
            JSON.stringify({
              message: { role: "assistant", content: "Here it is." },
              images: [{ documentId: "d1", filename: "portfolio.png", mime: "image/png" }],
            }),
        } as Response;
      }
      return {
        ok: true, status: 200, statusText: "OK",
        blob: async () => new Blob(["png"], { type: "image/png" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "show me the portfolio{Enter}");
    const thumb = await screen.findByAltText("portfolio.png");

    await userEvent.click(thumb);
    const dialog = await screen.findByRole("dialog", { name: "portfolio.png" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });
  it("shows no image strip when the reply has none", async () => {
    const fetchMock = installFetchMock({ "/api/chat": reply("Nothing visual here.") });
    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "who is Chen Lian{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Nothing visual here.")).toBeInTheDocument());
    // The brain mark is an <img> too; assert on attachments specifically.
    expect(screen.queryByAltText(/\.png$/)).not.toBeInTheDocument();
  });

  it("returns the message to the composer when the send fails", async () => {
    installFetchMock({
      "/api/chat": jsonResponse(502, { error: "no active LLM key for this org" }),
    });
    render(<Chat token="t" user={user} navigate={vi.fn()} />);
    const box = screen.getByLabelText("Message");

    await userEvent.type(box, "who is Li Wei's mother?{Enter}");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // The optimistic turn is rolled back, so it cannot be re-sent as context,
    // and the text is back where it was typed instead of being lost.
    console.log("HTML>>>", document.body.innerHTML);
    expect(box).toHaveValue("who is Li Wei's mother?");
  });

  it("drops a reply that belongs to a chat the user has left", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = reply("That answer belonged to chat A.");
    const answerText = answer.text;
    const chat = (id: string) =>
      jsonResponse(200, { chat: { id, title: id, updatedAt: "2026-10-31T00:00:00.000Z" }, messages: [] });

    installFetchMock({
      "/api/chat": { ...answer, text: async () => {
        await gate;
        return answerText();
      } },
      "/api/chats/a": chat("a"),
      "/api/chats/b": chat("b"),
    });

    const { rerender } = render(<Chat token="t" user={user} chatId="a" navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "question for A{Enter}");
    await waitFor(() => expect(screen.getByText("Thinking…")).toBeInTheDocument());

    // The answer is still in flight when the user opens a different chat.
    rerender(<Chat token="t" user={user} chatId="b" navigate={vi.fn()} />);
    release();

    await waitFor(() => expect(screen.queryByText(/belonged to chat A/)).not.toBeInTheDocument());
  });
});