(() => {
  const STORAGE_KEY = "yc:harness:tokens";
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const parseContext = (widget) => {
    const el = widget.querySelector("[data-terminal-context]");
    if (!el) return null;
    try {
      let parsed = JSON.parse(el.textContent.trim());
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const formatTokens = (n) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  };

  const formatDzd = (n) => `~${Number(n).toFixed(2)}`;

  const truncate = (str, max = 120) => {
    if (!str || str.length <= max) return str || "";
    return `${str.slice(0, max).trim()}…`;
  };

  const wrapText = (text, maxWidth = 88) => {
    if (!text) return [];
    const normalized = String(text).replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    const words = normalized.split(" ");
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines;
  };

  const SKILL_EMOJI_FALLBACK = {
    Languages: "⌨️",
    Backend: "⚙️",
    Cloud: "☁️",
    "DevOps & Infrastructure": "🏗️",
    Databases: "🗄️",
    "AI Frameworks": "🔗",
    "AI Platforms": "🤖",
    Security: "⚔️",
  };

  const skillCategoryEmoji = (cat) =>
    cat.emoji || SKILL_EMOJI_FALLBACK[cat.name] || "•";

  const LINK_RE = /(https?:\/\/[^\s<]+|mailto:[^\s<]+)/gi;

  const hasLinkableContent = (text) => /https?:\/\/|mailto:/i.test(text);

  const trimLinkTrailing = (url) => url.replace(/[.,;:!?)'\]]+$/, "");

  const commonPrefix = (strings) => {
    if (!strings.length) return "";
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      let j = 0;
      while (
        j < prefix.length &&
        j < strings[i].length &&
        prefix[j].toLowerCase() === strings[i][j].toLowerCase()
      ) {
        j += 1;
      }
      prefix = prefix.slice(0, j);
    }
    return prefix;
  };

  const linkifyElement = (el, plainText) => {
    const text = plainText ?? el.textContent ?? "";
    if (!text || !hasLinkableContent(text)) return;

    el.dataset.plainText = text;
    el.textContent = "";

    const frag = document.createDocumentFragment();
    let last = 0;
    const re = new RegExp(LINK_RE.source, LINK_RE.flags);
    let match;

    while ((match = re.exec(text)) !== null) {
      if (match.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      const raw = match[0];
      const href = trimLinkTrailing(raw);
      const trailing = raw.slice(href.length);

      const anchor = document.createElement("a");
      anchor.className = "pi-terminal-link";
      anchor.href = href;
      anchor.textContent = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.addEventListener("click", (e) => e.stopPropagation());
      frag.appendChild(anchor);

      if (trailing) {
        frag.appendChild(document.createTextNode(trailing));
      }
      last = match.index + raw.length;
    }

    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }

    el.appendChild(frag);
  };

  class TerminalHarness {
    constructor(widget) {
      this.widget = widget;
      this.ctx = parseContext(widget) || {};
      this.body = widget.querySelector("[data-terminal-body]");
      this.input = widget.querySelector("[data-terminal-input]");
      this.form = widget.querySelector("[data-terminal-form]");
      this.statusEl = widget.querySelector("[data-terminal-status]");
      this.titleEl = widget.querySelector("[data-terminal-title]");
      this.meterFill = widget.querySelector("[data-meter-fill]");
      this.meterValues = widget.querySelector("[data-meter-values]");
      this.meterMeta = widget.querySelector("[data-meter-meta]");
      this.meterDzd = widget.querySelector("[data-meter-dzd]");
      this.meterRate = widget.querySelector("[data-meter-rate]");
      this.history = [];
      this.historyIndex = -1;
      this.busy = false;
      this.exhausted = false;
      this.abortController = null;
      this.completePanel = widget.querySelector("[data-terminal-complete]");
      this.completeList = widget.querySelector("[data-terminal-complete-list]");
      this.slashCommands = (this.ctx.commands || []).map((c) => ({
        path: `/${c.name}`,
        name: c.name,
        description: c.description || "",
      }));
      this.completeOpen = false;
      this.completeIndex = -1;
      this.completeMatches = [];
      this.scrollEl = widget.querySelector("[data-terminal-scroll]");
      this.uiMode = "repl";
      this.blogPosts = this.ctx.posts || [];
      this.blogIndex = 0;
      this.savedScrollbackHTML = "";
      this.savedStripTitle = "";
      this.readerViewport = null;

      this.budget = {
        total: Number(this.ctx.budget?.total_tokens) || 50000,
        base: Number(this.ctx.budget?.base_cost) || 400,
        charsPerToken: Number(this.ctx.budget?.chars_per_token) || 2,
        clearCost: Number(this.ctx.budget?.clear_cost) || 50,
        usageCost: Number(this.ctx.budget?.usage_cost) || 80,
        dzdPer1k: Number(this.ctx.budget?.dzd_per_1k_tokens) || 8.5,
        currency: this.ctx.budget?.currency || "DZD",
      };

      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          this.used = Number(data.used) || 0;
          this.requestCount = Number(data.requests) || 0;
        } catch {
          this.used = 0;
          this.requestCount = 0;
        }
      } else {
        this.used = 0;
        this.requestCount = 0;
      }

      if (prefersReducedMotion) this.widget.classList.add("is-reduced-motion");

      if (this.remaining() <= 0) this.setExhausted();

      this.init();
    }

    init() {
      if (!this.body || !this.input) return;

      this.form?.addEventListener("submit", (e) => {
        e.preventDefault();
        void this.handleSubmit();
      });

      this.input.addEventListener("input", () => this.syncCompletionOnInput());

      this.input.addEventListener("keydown", (e) => {
        if (this.uiMode !== "repl") return;

        if (e.key === "Escape") {
          if (this.completeOpen) {
            e.preventDefault();
            this.closeComplete();
          }
          return;
        }

        if (e.key === "Tab") {
          if (!this.completionDisabled()) {
            e.preventDefault();
            this.onCompleteTab(e.shiftKey);
          }
          return;
        }

        if (e.key === "Enter" && this.completeOpen && this.completeIndex >= 0) {
          e.preventDefault();
          const match = this.completeMatches[this.completeIndex];
          if (match) this.applyComplete(match);
          this.closeComplete();
          return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const delta = e.key === "ArrowUp" ? -1 : 1;
          if (this.completeOpen && this.completeMatches.length) {
            this.navigateComplete(delta);
          } else {
            this.navigateHistory(delta);
          }
        }
      });

      this.widget.addEventListener("keydown", (e) => this.handleBlogKeys(e));

      this.scrollEl?.addEventListener("click", () => {
        if (this.uiMode !== "repl") {
          this.widget.focus();
          return;
        }
        if (!this.exhausted && !this.busy) this.input.focus();
      });

      void this.boot();
    }

    persistUsage() {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ used: this.used, requests: this.requestCount })
      );
    }

    remaining() {
      return Math.max(0, this.budget.total - this.used);
    }

    tokensToDzd(tokens) {
      return (tokens / 1000) * this.budget.dzdPer1k;
    }

    updateMeter() {
      const pct = Math.min(100, (this.used / this.budget.total) * 100);
      const spentDzd = this.tokensToDzd(this.used);
      const capDzd = this.tokensToDzd(this.budget.total);
      const { currency, dzdPer1k } = this.budget;

      if (this.meterFill) {
        this.meterFill.style.width = `${pct}%`;
        this.meterFill.classList.toggle("is-warning", pct >= 85 && pct < 100);
        this.meterFill.classList.toggle("is-critical", pct >= 100);
      }
      if (this.meterValues) {
        this.meterValues.textContent = `${formatTokens(this.used)} / ${formatTokens(this.budget.total)}`;
      }
      if (this.meterDzd) {
        this.meterDzd.textContent = `${formatDzd(spentDzd)} ${currency}`;
        this.meterDzd.title = `cap ${formatDzd(capDzd)} ${currency}`;
      }
      if (this.meterRate) {
        this.meterRate.textContent = `${dzdPer1k.toFixed(2)} ${currency} / 1k tok`;
      }
      if (this.meterMeta) {
        this.meterMeta.textContent = `${this.requestCount} req`;
      }
    }

    setStatus(text) {
      if (this.statusEl) this.statusEl.textContent = text;
    }

    setExhausted() {
      this.closeComplete();
      this.exhausted = true;
      this.widget.classList.add("is-exhausted");
      this.input.disabled = true;
      this.input.placeholder = "quota exceeded — refresh to continue";
      if (this.titleEl) this.titleEl.textContent = "yc@portfolio — hold";
      this.setStatus("suspended");
      this.updateMeter();
    }

    setBusy(busy) {
      if (busy) this.closeComplete();
      this.busy = busy;
      this.widget.classList.toggle("is-busy", busy);
      if (!this.exhausted) this.input.disabled = busy;
      this.setStatus(busy ? "busy" : "ready");
    }

    appendEchoLine(cmd) {
      const line = document.createElement("div");
      line.className = "pi-terminal-line pi-terminal-line--prompt";
      line.textContent = `yc@portfolio › ${cmd}`;
      this.body.appendChild(line);
      this.scrollToBottom();
    }

    scrollToBottom() {
      const scroll = this.widget.querySelector("[data-terminal-scroll]");
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }

    async streamLines(lines, signal) {
      for (const line of lines) {
        if (signal?.aborted) return 0;
        const chars = await this.streamLine(line, signal);
        if (signal?.aborted) return 0;
        await sleep(line.pause_after_ms ?? 80);
      }
      return lines.reduce((sum, l) => sum + (l.text?.length || 0), 0);
    }

    async streamLine(line, signal) {
      const text = line.text || "";
      const delay = prefersReducedMotion ? 0 : (line.delay_ms ?? 14);
      const el = document.createElement("div");
      el.className = `pi-terminal-line pi-terminal-line--${line.type || "dim"}${
        line.category ? " pi-terminal-line--category" : ""
      }${line.prose ? " pi-terminal-line--prose" : ""}`;
      const cursor = document.createElement("span");
      cursor.className = "pi-terminal-cursor";
      cursor.setAttribute("aria-hidden", "true");
      el.appendChild(cursor);
      this.body.appendChild(el);
      this.scrollToBottom();

      if (prefersReducedMotion || delay === 0) {
        cursor.remove();
        el.textContent = text;
        linkifyElement(el, text);
        this.scrollToBottom();
        return text.length;
      }

      for (let i = 0; i < text.length; i++) {
        if (signal?.aborted) return i;
        cursor.before(text.charAt(i));
        await sleep(delay);
      }
      cursor.remove();
      linkifyElement(el, text);
      this.scrollToBottom();
      return text.length;
    }

    computeCost(cmd, charsStreamed, isClear) {
      if (isClear) return this.budget.clearCost;
      if (cmd === "/usage") return this.budget.usageCost;
      if (cmd === "/blog") return this.budget.base;
      return this.budget.base + charsStreamed * this.budget.charsPerToken;
    }

    charge(cost) {
      this.used = Math.min(this.budget.total, this.used + cost);
      this.requestCount += 1;
      this.persistUsage();
      this.updateMeter();
      if (this.remaining() <= 0) this.setExhausted();
    }

    completionDisabled() {
      return this.busy || this.exhausted || this.uiMode !== "repl";
    }

    handleBlogKeys(e) {
      if (this.uiMode === "repl") return;

      if (this.uiMode === "blogList") {
        if (e.key === "Escape") {
          e.preventDefault();
          this.exitBlogToRepl();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.blogIndex = Math.max(0, this.blogIndex - 1);
          this.renderBlogList();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          this.blogIndex = Math.min(this.blogPosts.length - 1, this.blogIndex + 1);
          this.renderBlogList();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const post = this.blogPosts[this.blogIndex];
          if (post) this.openBlogReader(post);
        }
        return;
      }

      if (this.uiMode === "blogReader") {
        const vp = this.readerViewport;
        if (e.key === "Escape" || e.key === "q") {
          e.preventDefault();
          this.closeBlogReaderToList();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (vp) vp.scrollTop -= 28;
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (vp) vp.scrollTop += 28;
        } else if (e.key === "PageUp") {
          e.preventDefault();
          if (vp) vp.scrollTop -= vp.clientHeight * 0.85;
        } else if (e.key === "PageDown") {
          e.preventDefault();
          if (vp) vp.scrollTop += vp.clientHeight * 0.85;
        } else if (e.key === "g") {
          e.preventDefault();
          if (vp) vp.scrollTop = 0;
        } else if (e.key === "G") {
          e.preventDefault();
          if (vp) vp.scrollTop = vp.scrollHeight;
        }
      }
    }

    enterBlogList() {
      this.closeComplete();
      this.blogPosts = this.ctx.posts || [];
      this.savedScrollbackHTML = this.body.innerHTML;
      this.savedStripTitle = this.titleEl?.textContent || "";
      this.uiMode = "blogList";
      this.blogIndex = 0;
      this.widget.classList.remove("is-blog-reader");
      this.widget.classList.add("is-blog-list");
      this.input.disabled = true;
      if (this.titleEl) this.titleEl.textContent = "blog — select post";
      this.setStatus("↑↓ enter esc");
      this.renderBlogList();
      this.widget.focus();
    }

    exitBlogToRepl() {
      this.uiMode = "repl";
      this.widget.classList.remove("is-blog-list", "is-blog-reader");
      this.body.innerHTML = this.savedScrollbackHTML;
      this.readerViewport = null;
      if (this.titleEl) this.titleEl.textContent = this.savedStripTitle;
      if (!this.exhausted && !this.busy) {
        this.setStatus("ready");
        this.input.disabled = false;
        this.input.focus();
      } else if (this.exhausted) {
        this.setStatus("suspended");
      }
    }

    renderBlogList() {
      this.body.innerHTML = "";

      const header = document.createElement("div");
      header.className = "pi-terminal-line pi-terminal-line--success";
      header.textContent = `blog — ${this.blogPosts.length} post${this.blogPosts.length === 1 ? "" : "s"}`;
      this.body.appendChild(header);

      const hint = document.createElement("div");
      hint.className = "pi-terminal-line pi-terminal-line--dim";
      hint.textContent = "↑↓ select · enter read · esc back";
      this.body.appendChild(hint);

      const list = document.createElement("div");
      list.className = "pi-terminal-blog-list";
      list.setAttribute("role", "listbox");

      this.blogPosts.forEach((post, i) => {
        const row = document.createElement("div");
        row.className =
          "pi-terminal-blog-item" + (i === this.blogIndex ? " is-active" : "");
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", i === this.blogIndex ? "true" : "false");

        const slug = document.createElement("span");
        slug.className = "pi-terminal-blog-item__slug";
        slug.textContent = `▸ ${post.slug}`;

        const meta = document.createElement("span");
        meta.className = "pi-terminal-blog-item__meta";
        meta.textContent = [post.date, post.title].filter(Boolean).join("  ");

        row.appendChild(slug);
        row.appendChild(meta);
        list.appendChild(row);
      });

      this.body.appendChild(list);
      list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
      if (this.scrollEl) this.scrollEl.scrollTop = 0;
    }

    openBlogReader(post) {
      this.uiMode = "blogReader";
      this.widget.classList.remove("is-blog-list");
      this.widget.classList.add("is-blog-reader");
      if (this.titleEl) this.titleEl.textContent = `blog — ${post.slug}`;
      this.setStatus("esc q ↑↓");

      this.body.innerHTML = "";

      const titleLine = document.createElement("div");
      titleLine.className = "pi-terminal-line pi-terminal-line--tool";
      titleLine.textContent = post.title || post.slug;
      this.body.appendChild(titleLine);

      if (post.date || post.summary) {
        const metaLine = document.createElement("div");
        metaLine.className = "pi-terminal-line pi-terminal-line--dim";
        metaLine.textContent = [post.date, post.summary].filter(Boolean).join(" — ");
        this.body.appendChild(metaLine);
      }

      const reader = document.createElement("div");
      reader.className = "pi-terminal-reader";

      const baseUrl = String(this.ctx.site?.baseURL || "").replace(/\/$/, "");
      const webLine = document.createElement("div");
      webLine.className = "pi-terminal-line pi-terminal-line--dim";
      webLine.textContent = baseUrl
        ? `w — open ${baseUrl}/blog/${post.slug}/ in browser`
        : `w — open /blog/${post.slug}/ in browser`;

      const hint = document.createElement("div");
      hint.className = "pi-terminal-reader__hint pi-terminal-line pi-terminal-line--dim";
      hint.textContent = "esc · q back  ·  ↑↓ scroll  ·  g/G top/bottom";

      const viewport = document.createElement("div");
      viewport.className = "pi-terminal-reader__viewport";
      viewport.setAttribute("tabindex", "-1");

      const pre = document.createElement("pre");
      pre.className = "pi-terminal-reader__content";
      pre.textContent = post.body || "(empty post)";

      viewport.appendChild(pre);
      reader.appendChild(webLine);
      reader.appendChild(hint);
      reader.appendChild(viewport);
      this.body.appendChild(reader);
      this.readerViewport = viewport;

      viewport.focus();
      if (this.scrollEl) this.scrollEl.scrollTop = 0;
    }

    closeBlogReaderToList() {
      this.uiMode = "blogList";
      this.widget.classList.remove("is-blog-reader");
      this.widget.classList.add("is-blog-list");
      this.readerViewport = null;
      if (this.titleEl) this.titleEl.textContent = "blog — select post";
      this.setStatus("↑↓ enter esc");
      this.renderBlogList();
      this.widget.focus();
    }

    runBlog() {
      const posts = this.ctx.posts || [];
      if (!posts.length) {
        return [
          { type: "warn", text: "no blog posts yet." },
          { type: "dim", text: "add markdown under content/en/blog/" },
        ];
      }
      this.blogPosts = posts;
      this.charge(this.budget.base);
      this.enterBlogList();
      return null;
    }

    getInputCommandToken() {
      const first = this.input.value.split(/\s+/)[0] || "";
      return first.toLowerCase();
    }

    setInputCommandToken(newToken) {
      const parts = this.input.value.split(/\s+/);
      parts[0] = newToken;
      this.input.value = parts.join(" ");
    }

    filterCommands() {
      const token = this.getInputCommandToken();
      if (!token.startsWith("/")) return [];
      return this.slashCommands.filter((c) => c.path.toLowerCase().startsWith(token));
    }

    applyComplete(match) {
      const parts = this.input.value.split(/\s+/);
      const rest = parts.slice(1).join(" ");
      this.input.value = rest ? `${match.path} ${rest}` : match.path;
    }

    openComplete(matches, activeIndex) {
      this.completeOpen = true;
      this.completeMatches = matches;
      if (this.completePanel) this.completePanel.hidden = false;
      this.input.setAttribute("aria-expanded", "true");
      this.renderComplete(matches, activeIndex);
    }

    closeComplete() {
      this.completeOpen = false;
      this.completeIndex = -1;
      this.completeMatches = [];
      if (this.completePanel) this.completePanel.hidden = true;
      this.input.setAttribute("aria-expanded", "false");
      this.input.removeAttribute("aria-activedescendant");
      if (this.completeList) this.completeList.innerHTML = "";
    }

    renderComplete(matches, activeIndex) {
      if (!this.completeList) return;
      this.completeList.innerHTML = "";
      matches.forEach((m, i) => {
        const li = document.createElement("li");
        li.className =
          "pi-terminal-complete__item" + (i === activeIndex ? " is-active" : "");
        li.id = `pi-terminal-complete-opt-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", i === activeIndex ? "true" : "false");

        const cmd = document.createElement("span");
        cmd.className = "pi-terminal-complete__cmd";
        cmd.textContent = m.path;

        const desc = document.createElement("span");
        desc.className = "pi-terminal-complete__desc";
        desc.textContent = m.description;

        li.appendChild(cmd);
        li.appendChild(desc);

        li.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          this.applyComplete(m);
          this.closeComplete();
          this.input.focus();
        });

        this.completeList.appendChild(li);
      });

      if (activeIndex >= 0) {
        this.input.setAttribute("aria-activedescendant", `pi-terminal-complete-opt-${activeIndex}`);
        this.completeList.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
      } else {
        this.input.removeAttribute("aria-activedescendant");
      }
    }

    syncCompletionOnInput() {
      if (this.completionDisabled()) {
        this.closeComplete();
        return;
      }

      const token = this.getInputCommandToken();
      if (!token.startsWith("/")) {
        this.closeComplete();
        return;
      }

      const matches = this.filterCommands();
      if (!matches.length) {
        this.closeComplete();
        return;
      }

      this.completeIndex = -1;
      this.openComplete(matches, -1);
    }

    onCompleteTab(reverse = false) {
      const matches = this.filterCommands();
      if (!matches.length) {
        this.closeComplete();
        return;
      }

      if (matches.length === 1) {
        this.applyComplete(matches[0]);
        this.completeIndex = 0;
        this.openComplete(matches, 0);
        return;
      }

      const token = this.getInputCommandToken();
      const paths = matches.map((m) => m.path);
      const prefix = commonPrefix(paths);

      if (this.completeIndex < 0 && prefix.length > token.length) {
        this.setInputCommandToken(prefix);
        this.completeIndex = reverse ? matches.length - 1 : 0;
        this.applyComplete(matches[this.completeIndex]);
        this.openComplete(matches, this.completeIndex);
        return;
      }

      const delta = reverse ? -1 : 1;
      if (this.completeIndex < 0) {
        this.completeIndex = reverse ? matches.length - 1 : 0;
      } else {
        this.completeIndex = (this.completeIndex + delta + matches.length) % matches.length;
      }

      this.applyComplete(matches[this.completeIndex]);
      this.openComplete(matches, this.completeIndex);
    }

    navigateComplete(delta) {
      if (!this.completeMatches.length) return;
      const len = this.completeMatches.length;
      if (this.completeIndex < 0) {
        this.completeIndex = delta < 0 ? len - 1 : 0;
      } else {
        this.completeIndex = (this.completeIndex + delta + len) % len;
      }
      this.applyComplete(this.completeMatches[this.completeIndex]);
      this.renderComplete(this.completeMatches, this.completeIndex);
    }

    navigateHistory(delta) {
      this.closeComplete();
      if (!this.history.length) return;
      if (this.historyIndex < 0) this.historyIndex = this.history.length;
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + delta));
      this.input.value = this.history[this.historyIndex] || "";
    }

    async boot() {
      this.setBusy(true);
      this.updateMeter();

      if (this.exhausted) {
        await this.runExhausted();
        return;
      }

      const welcome = (this.ctx.welcome?.lines || []).map((t) => ({ type: "agent", text: t }));
      const hints = (this.ctx.boot_hints?.lines || []).map((t) => ({ type: "dim", text: t }));

      await this.streamLines([...welcome, ...hints], null);

      this.setBusy(false);
      if (!this.exhausted) {
        this.input.disabled = false;
        this.input.focus();
        this.tryOpenReadDeepLink();
      }
    }

    tryOpenReadDeepLink() {
      const slug = new URLSearchParams(window.location.search).get("read");
      if (!slug) return;

      const posts = this.ctx.posts || [];
      const post = posts.find((p) => p.slug === slug);
      if (!post) return;

      this.enterBlogList();
      const idx = posts.findIndex((p) => p.slug === slug);
      if (idx >= 0) this.blogIndex = idx;
      this.openBlogReader(post);

      const url = new URL(window.location.href);
      url.searchParams.delete("read");
      history.replaceState(null, "", url.pathname + url.hash);
    }

    async handleSubmit() {
      this.closeComplete();
      if (this.uiMode !== "repl") return;

      const raw = this.input.value.trim();
      if (!raw || this.busy) return;

      this.history.push(raw);
      this.historyIndex = -1;
      this.input.value = "";
      this.appendEchoLine(raw);

      if (this.exhausted || this.remaining() <= 0) {
        await this.runExhausted();
        return;
      }

      const cmd = raw.toLowerCase().split(/\s+/)[0];
      if (!cmd.startsWith("/")) {
        await this.respond([
          { type: "warn", text: "commands must start with /" },
          { type: "dim", text: "try /help" },
        ], raw, false);
        return;
      }

      if (cmd === "/clear") {
        await this.runClear();
        return;
      }

      if (cmd === "/blog") {
        const blogLines = this.runBlog();
        if (blogLines) {
          await this.respond(blogLines, raw, false);
        }
        return;
      }

      const lines = this.resolveCommand(cmd);
      const isUsage = cmd === "/usage";
      await this.respond(lines, raw, isUsage);
    }

    async runExhausted() {
      const lines = this.ctx.exhausted?.lines || [
        { type: "warn", text: "billing error: quota exceeded" },
        { type: "agent", text: "yassine has an unpaid bill." },
      ];
      this.setBusy(true);
      await this.streamLines(lines, null);
      this.setBusy(false);
      this.setExhausted();
    }

    async runClear() {
      this.abortPlayback();
      this.setBusy(true);
      const lines = [{ type: "dim", text: "screen cleared." }];
      const chars = await this.streamLines(lines, null);
      this.body.innerHTML = "";
      const cost = this.computeCost("/clear", chars, true);
      this.charge(cost);
      this.setBusy(false);
      if (!this.exhausted) this.input.focus();
    }

    abortPlayback() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    async respond(lines, raw, skipRequestCountStyle = false) {
      this.abortPlayback();
      const signal = new AbortController();
      this.abortController = signal;
      this.setBusy(true);

      const cmd = raw.toLowerCase().split(/\s+/)[0];
      const chars = await this.streamLines(lines, signal);
      if (signal.aborted) return;

      const cost = this.computeCost(cmd, chars, false);
      this.charge(cost);
      this.setBusy(false);
      if (!this.exhausted) this.input.focus();
    }

    resolveCommand(cmd) {
      const map = {
        "/help": () => this.cmdHelp(),
        "/whoami": () => this.cmdWhoami(),
        "/experience": () => this.cmdExperience(),
        "/skills": () => this.cmdSkills(),
        "/projects": () => this.cmdProjects(),
        "/hireme": () => this.cmdHireme(),
        "/usage": () => this.cmdUsage(),
      };

      const fn = map[cmd];
      if (!fn) {
        return [
          { type: "warn", text: `command not found: ${cmd}` },
          { type: "dim", text: "type /help for available commands" },
        ];
      }
      return fn();
    }

    cmdHelp() {
      const cmds = this.ctx.commands || [];
      const lines = [{ type: "success", text: "available commands:" }];
      cmds.forEach((c) => {
        lines.push({
          type: "tool",
          text: `  /${c.name} — ${c.description || ""}`,
        });
      });
      return lines;
    }

    cmdWhoami() {
      const a = this.ctx.author || {};
      return [
        { type: "success", text: a.name || "Yassine Cherair" },
        { type: "dim", text: a.location || "" },
        { type: "agent", text: a.description || "" },
        { type: "tool", text: `github: ${a.github || "—"}` },
        { type: "tool", text: `linkedin: ${a.linkedin || "—"}` },
        { type: "tool", text: `email: ${a.email || "—"}` },
      ].filter((l) => l.text);
    }

    cmdExperience() {
      const jobs = this.ctx.experience || [];
      if (!jobs.length) return [{ type: "warn", text: "no experience data loaded." }];
      const lines = [{ type: "success", text: "experience:" }];
      jobs.forEach((j) => {
        lines.push({ type: "tool", text: `▸ ${j.role} @ ${j.company}` });
        lines.push({ type: "dim", text: `  ${j.period || ""}${j.country ? ` · ${j.country}` : ""}` });
        if (j.description) {
          lines.push({ type: "agent", prose: true, text: j.description });
        }
        lines.push({ type: "dim", text: "" });
      });
      return lines;
    }

    cmdSkills() {
      const skills = this.ctx.skills || {};
      const categories = skills.categories || [];

      if (categories.length) {
        const lines = [{ type: "success", text: `skills — ${categories.length} categories` }];
        categories.forEach((cat) => {
          const emoji = skillCategoryEmoji(cat);
          const label = `${emoji}  ${cat.name}`;
          lines.push({ type: "tool", text: label, category: true });
          const items = (cat.items || []).map((i) => i.name).filter(Boolean);
          if (items.length) {
            lines.push({ type: "dim", text: `  ${items.join(" · ")}` });
          }
        });
        return lines;
      }

      const tech = this.ctx.tech || {};
      const row1 = (tech.row1 || []).map((t) => t.name).filter(Boolean);
      const row2 = (tech.row2 || []).map((t) => t.name).filter(Boolean);
      return [
        { type: "success", text: "skills:" },
        { type: "tool", text: `infra & platform: ${row1.join(" · ")}` },
        { type: "tool", text: `ai & security: ${row2.join(" · ")}` },
      ];
    }

    cmdProjects() {
      const projects = this.ctx.projects || [];
      if (!projects.length) return [{ type: "warn", text: "no projects loaded." }];
      const github = this.ctx.author?.github || "https://github.com/yassinech-99";
      const lines = [{ type: "success", text: "projects:" }];
      projects.forEach((p) => {
        lines.push({ type: "tool", text: `▸ ${p.title}` });
        if (p.tech) {
          const stack = String(p.tech)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (stack.length) {
            lines.push({ type: "dim", text: `  stack: ${stack.join(" · ")}` });
          }
        }
        if (p.description) {
          lines.push({ type: "agent", prose: true, text: p.description });
        }
        if (p.link && p.link !== "#") {
          lines.push({ type: "dim", text: `  → ${p.link}` });
        }
        lines.push({ type: "dim", text: "" });
      });
      lines.push({ type: "agent", text: `check my github → ${github}` });
      return lines;
    }

    cmdHireme() {
      const a = this.ctx.author || {};
      const lines = [
        { type: "success", text: "let's talk — open to interesting work." },
        { type: "tool", text: `email: ${a.email || "yassinecherair@gmail.com"}` },
        { type: "tool", text: `github: ${a.github || ""}` },
        { type: "tool", text: `linkedin: ${a.linkedin || ""}` },
        { type: "agent", text: "security × software × AI is where I do my best work." },
      ];
      if (a.discord) {
        lines.splice(4, 0, { type: "tool", text: `discord: ${a.discord}` });
      }
      return lines.filter((l) => l.text);
    }

    cmdUsage() {
      const rem = this.remaining();
      const pct = ((this.used / this.budget.total) * 100).toFixed(1);
      const { currency, dzdPer1k } = this.budget;
      const spentDzd = this.tokensToDzd(this.used);
      const remDzd = this.tokensToDzd(rem);
      const capDzd = this.tokensToDzd(this.budget.total);
      return [
        { type: "success", text: "session usage:" },
        { type: "tool", text: `  consumed: ${formatTokens(this.used)} tokens (${pct}%)` },
        { type: "tool", text: `  remaining: ${formatTokens(rem)} tokens` },
        { type: "tool", text: `  spent: ${formatDzd(spentDzd)} ${currency}` },
        { type: "tool", text: `  remaining: ${formatDzd(remDzd)} ${currency}` },
        { type: "tool", text: `  rate: ${dzdPer1k.toFixed(2)} ${currency} / 1k tokens` },
        { type: "tool", text: `  cap: ${formatDzd(capDzd)} ${currency} (${formatTokens(this.budget.total)} tokens)` },
        { type: "tool", text: `  requests: ${this.requestCount}` },
        { type: "dim", text: "refresh page to reset free tier." },
      ];
    }
  }

  const boot = () => {
    document.querySelectorAll("[data-terminal-harness]").forEach((w) => new TerminalHarness(w));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
