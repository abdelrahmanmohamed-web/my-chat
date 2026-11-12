import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "@/app/App";

describe("Phase 0 smoke test", () => {
  it("renders the Arabic RTL application shell", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "تطبيق المحادثة",
    );
  });
});
