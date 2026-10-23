import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { ThemeToggle } from "../components/ThemeToggle";
import { registerSchema } from "../lib/schemas";
import { ThemeProvider } from "../providers/ThemeProvider";

const auth = vi.hoisted(() => ({ value: { user: null as unknown, loading: false } }));
vi.mock("../providers/AuthProvider", () => ({ useAuth: () => auth.value }));

describe("theme", () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.className = ""; });

  it("toggles instantly and persists the choice", () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement).not.toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: /switch to dark/i }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("trashmorph-theme")).toBe("dark");
  });

  it("restores a saved preference on load", () => {
    localStorage.setItem("trashmorph-theme", "dark");
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button", { name: /switch to light/i })).toBeInTheDocument();
  });
});

describe("ProtectedRoute", () => {
  const tree = () => (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<ProtectedRoute />}><Route path="/dashboard" element={<p>secret</p>} /></Route>
      </Routes>
    </MemoryRouter>
  );
  it("redirects anonymous users to login", () => { auth.value = { user: null, loading: false }; render(tree()); expect(screen.getByText("login page")).toBeInTheDocument(); });
  it("shows nothing protected while the session loads", () => { auth.value = { user: null, loading: true }; render(tree()); expect(screen.queryByText("secret")).not.toBeInTheDocument(); expect(screen.queryByText("login page")).not.toBeInTheDocument(); });
  it("renders for signed-in users", () => { auth.value = { user: { id: "u" }, loading: false }; render(tree()); expect(screen.getByText("secret")).toBeInTheDocument(); });
});

describe("registerSchema", () => {
  const ok = { fullName: "Ana Silva", email: "ana@example.com", password: "greenplanet42", confirm: "greenplanet42", terms: true as const };
  it("accepts valid input", () => expect(registerSchema.safeParse(ok).success).toBe(true));
  it("rejects weak, mismatched and unaccepted input", () => {
    expect(registerSchema.safeParse({ ...ok, password: "short1", confirm: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, password: "onlyletterspassword", confirm: "onlyletterspassword" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, confirm: "different42pass" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, terms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
  });
});
