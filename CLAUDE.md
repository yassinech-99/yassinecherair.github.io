# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A personal portfolio and blog site for Yassine Cherair, built with Hugo and the [hugo-noir](https://github.com/prxshetty/hugo-noir) theme (installed as a git submodule). The site is data-driven: most content (experience, projects, certifications, tech stack) lives in TOML data files rather than Markdown content pages.

## Commands

```bash
# Start dev server (live reload at http://localhost:1313)
hugo server

# Build static site to public/
hugo --minify

# Create new blog post
hugo new content/en/blogs/my-post.md

# Initialize/update the hugo-noir theme submodule
git submodule update --init --recursive
```

Hugo Extended ≥ 0.92.0 is required.

## Architecture

### Content vs. Data Split

Most site sections are **not** Markdown pages — they are rendered from `data/en/*.toml` files directly in `layouts/index.html`:

| Section | Source |
|---|---|
| Author bio / social links | `data/en/author.toml` |
| Experience timeline | `data/en/experience.toml` |
| Tech carousel | `data/en/tech.toml` |
| Projects | `data/en/projects.toml` |
| Certifications | `data/en/certifications.toml` |
| Honors | `data/en/honors.toml` |
| Voluntary work | `data/en/voluntary.toml` |

Blog posts are the only true Markdown content, under `content/en/blogs/`.

### Layout Override Strategy

Hugo's lookup order means files in `layouts/` override the theme's equivalents in `themes/hugo-noir/layouts/`. Currently overridden:

- `layouts/index.html` — full custom homepage (814 lines); replaces theme's index entirely
- `layouts/partials/header.html` — custom nav with time display, language switcher, theme toggle
- `layouts/partials/footer.html` — custom footer

Theme layouts in `themes/hugo-noir/layouts/_default/` handle all other pages (single blog posts, list, about, contact, experience, projects).

### Multilingual Setup

`hugo.toml` sets `defaultContentLanguageInSubdir = true`, so all URLs are prefixed with `/en/`. Content lives under `content/en/` and data under `data/en/`. Spanish and French are stubbed in the theme but not active.

### Theme Internals

The `hugo-noir` theme uses Tailwind CSS (CDN in production). `themes/hugo-noir/assets/css/main.css` is the primary stylesheet. The theme has its own `package.json` for PostCSS/Autoprefixer in dev CSS builds — the site root does not have a `package.json`.

### Key hugo.toml Notes

- `baseURL` is currently set to `https://example.org/` and needs to be updated before deployment
- Menu items (About, Experience, Projects, Blog, Contact) are defined in `hugo.toml` under `[[languages.en.menu.main]]`
- Social links are in `[params]` but the custom layouts read from `data/en/author.toml` instead
