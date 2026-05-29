(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const parseScenes = (widget) => {
    const dataEl = widget.querySelector("[data-terminal-scenes]");
    if (!dataEl) return [];
    try {
      let parsed = JSON.parse(dataEl.textContent.trim());
      if (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  class TerminalPlayer {
    constructor(widget) {
      this.widget = widget;
      this.scenes = parseScenes(widget);
      this.tabsEl = widget.querySelector("[data-terminal-tabs]");
      this.titleEl = widget.querySelector("[data-terminal-title]");
      this.bodyEl = widget.querySelector("[data-terminal-body]");
      this.copyBtn = widget.querySelector("[data-terminal-copy]");
      this.sceneIndex = Number(widget.dataset.defaultIndex) || 0;
      this.userPickedTab = false;
      this.autoAdvance = widget.dataset.autoAdvance !== "false";
      this.abortController = null;
      this.lastPrompt = "";

      if (prefersReducedMotion) {
        this.widget.classList.add("is-reduced-motion");
      }

      this.init();
    }

    init() {
      if (!this.scenes.length || !this.bodyEl) return;

      this.renderTabs();
      this.copyBtn?.addEventListener("click", () => this.copyLastPrompt());
      void this.runPlayback();
    }

    async runPlayback() {
      await this.playScene(this.sceneIndex);
      if (this.autoAdvance && !prefersReducedMotion && !this.userPickedTab) {
        await this.autoAdvanceLoop();
      }
    }

    renderTabs() {
      if (!this.tabsEl) return;
      this.tabsEl.innerHTML = "";
      this.scenes.forEach((scene, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pi-terminal-tab" + (index === this.sceneIndex ? " is-active" : "");
        btn.textContent = scene.label || scene.id || `Scene ${index + 1}`;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", index === this.sceneIndex ? "true" : "false");
        btn.addEventListener("click", () => {
          this.userPickedTab = true;
          void this.playScene(index);
        });
        this.tabsEl.appendChild(btn);
      });
    }

    setActiveTab(index) {
      this.sceneIndex = index;
      this.tabsEl?.querySelectorAll(".pi-terminal-tab").forEach((tab, i) => {
        tab.classList.toggle("is-active", i === index);
        tab.setAttribute("aria-selected", i === index ? "true" : "false");
      });
      const scene = this.scenes[index];
      if (this.titleEl && scene?.window_title) {
        this.titleEl.textContent = scene.window_title;
      }
    }

    abortPlayback() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    async playScene(index) {
      this.abortPlayback();
      const signal = new AbortController();
      this.abortController = signal;

      const scene = this.scenes[index];
      if (!scene) return;

      this.setActiveTab(index);
      this.bodyEl.innerHTML = "";
      this.widget.classList.remove("is-fading");

      const lines = scene.lines || [];

      if (prefersReducedMotion || signal.aborted) {
        lines.forEach((line) => this.appendLine(line, line.text || ""));
        return;
      }

      for (const line of lines) {
        if (signal.aborted) return;
        await this.typeLine(line, signal);
        if (signal.aborted) return;
        await sleep(line.pause_after_ms ?? 120);
      }
    }

    async typeLine(line, signal) {
      const text = line.text || "";
      const delay = line.delay_ms ?? 22;
      const el = this.createLineElement(line);
      const cursor = document.createElement("span");
      cursor.className = "pi-terminal-cursor";
      cursor.setAttribute("aria-hidden", "true");
      el.appendChild(cursor);
      this.bodyEl.appendChild(el);
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;

      if (line.type === "prompt") {
        this.lastPrompt = text.replace(/^\$\s*/, "");
      }

      for (let i = 0; i < text.length; i++) {
        if (signal.aborted) return;
        cursor.before(text.charAt(i));
        await sleep(delay);
      }

      cursor.remove();
    }

    createLineElement(line) {
      const el = document.createElement("div");
      el.className = `pi-terminal-line pi-terminal-line--${line.type || "dim"}`;
      return el;
    }

    appendLine(line, text) {
      const el = this.createLineElement(line);
      el.textContent = text;
      this.bodyEl.appendChild(el);
      if (line.type === "prompt") {
        this.lastPrompt = text.replace(/^\$\s*/, "");
      }
    }

    async copyLastPrompt() {
      if (!this.lastPrompt) return;
      try {
        await navigator.clipboard.writeText(this.lastPrompt);
        const original = this.copyBtn.textContent;
        this.copyBtn.textContent = "Copied";
        setTimeout(() => {
          this.copyBtn.textContent = original;
        }, 1500);
      } catch {
        /* ignore */
      }
    }

    async autoAdvanceLoop() {
      while (!this.userPickedTab) {
        await sleep(2000);
        if (this.userPickedTab) break;

        this.widget.classList.add("is-fading");
        await sleep(400);
        if (this.userPickedTab) break;

        const next = (this.sceneIndex + 1) % this.scenes.length;
        await this.playScene(next);

        this.widget.classList.remove("is-fading");
      }
    }
  }

  const boot = () => {
    document.querySelectorAll("[data-terminal-widget]").forEach((widget) => {
      new TerminalPlayer(widget);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
