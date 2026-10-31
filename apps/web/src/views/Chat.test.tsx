// Chat keyboard behaviour: Enter sends, Shift+Enter writes a new line, and an
// in-progress IME composition is never cut short by the Enter that commits it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { Chat } from "./Chat";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

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
