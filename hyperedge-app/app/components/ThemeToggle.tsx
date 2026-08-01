"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

type Theme = "light" | "dark";

const THEME_KEY = "hyperedge-theme-v1";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = window.localStorage.getItem(THEME_KEY);
    const active = stored === "light" || stored === "dark" ? stored : systemTheme();

    document.documentElement.dataset.theme = active;

    const handleSystemChange = () => {
      if (window.localStorage.getItem(THEME_KEY)) return;
      document.documentElement.dataset.theme = systemTheme();
    };

    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  function toggleTheme() {
    const explicit = document.documentElement.dataset.theme;
    const current = explicit === "light" || explicit === "dark" ? explicit : systemTheme();
    const next = current === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button
      className="icon-button hl-theme-toggle"
      type="button"
      title="Toggle color theme"
      aria-label="Toggle color theme"
      onClick={toggleTheme}
    >
      <Sun className="hl-theme-sun" size={17} />
      <Moon className="hl-theme-moon" size={17} />
    </button>
  );
}
