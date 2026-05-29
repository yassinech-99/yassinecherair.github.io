(() => {
  const storageKey = "pi:theme";
  const root = document.documentElement;
  const colorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const modeOrder = ["light", "dark", "system"];

  const getMode = () => {
    const mode = root.dataset.themeMode;
    return mode === "system" || mode === "light" || mode === "dark" ? mode : "light";
  };

  const getThemeForMode = (mode) =>
    mode === "system" ? (colorSchemeMediaQuery.matches ? "dark" : "light") : mode;

  const getNextMode = (mode) => modeOrder[(modeOrder.indexOf(mode) + 1) % modeOrder.length];

  const getModeLabel = (mode, theme) => (mode === "system" ? `system (${theme})` : theme);

  const syncDarkClass = (theme) => {
    root.classList.toggle("dark", theme === "dark");
  };

  const syncThemeControls = () => {
    const mode = getMode();
    const theme = getThemeForMode(mode);
    const nextMode = getNextMode(mode);
    const nextLabel = nextMode === "system" ? "system theme" : `${getThemeForMode(nextMode)} theme`;
    const label = `Theme preference: ${getModeLabel(mode, theme)}. Switch to ${nextLabel}.`;

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.setAttribute("data-theme-target", nextMode);
    });
  };

  const setMode = (mode) => {
    if (mode !== "system" && mode !== "dark" && mode !== "light") return;

    const theme = getThemeForMode(mode);
    root.dataset.theme = theme;
    root.dataset.themeMode = mode;
    root.style.colorScheme = theme;
    syncDarkClass(theme);

    if (mode === "system") {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, mode);
    }

    syncThemeControls();
    window.dispatchEvent(new CustomEvent("pi:themechange", { detail: { mode, theme } }));
  };

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const toggle = event.target.closest("[data-theme-toggle]");
    const mode = toggle?.getAttribute("data-theme-target");

    if (mode) {
      setMode(mode);
    }
  });

  const bindMediaQueryChange = (mediaQuery, handler) => {
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handler);
      return;
    }
    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handler);
    }
  };

  bindMediaQueryChange(colorSchemeMediaQuery, () => {
    if (getMode() !== "system") return;
    setMode("system");
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    const mode =
      event.newValue === "light" || event.newValue === "dark" ? event.newValue : "light";
    setMode(mode);
  });

  const storedMode = localStorage.getItem(storageKey);
  const initialMode =
    storedMode === "light" || storedMode === "dark" ? storedMode : "light";
  setMode(initialMode);
})();
