# @marmot-sh/web

Landing page and reference docs for [marmot.sh](https://marmot.sh).

Built with [TanStack Start](https://tanstack.com/start), [fumadocs](https://fumadocs.dev), and Tailwind CSS v4.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3001
pnpm build
pnpm preview
pnpm check-types
```

## Structure

```
content/
  docs/
    ai.mdx           # AI CLI reference
    meta.json        # docs nav
src/
  routes/
    __root.tsx       # root layout
    index.tsx        # landing page
    docs.$.tsx       # docs catch-all
  lib/
    source.ts        # fumadocs source loader
  components/
    app-header.tsx
    docs-sidebar-nav.tsx
    logo.tsx
  styles.css         # Tailwind + fumadocs theme
```

## License

MIT. See the root [LICENSE](https://github.com/marmot-sh/marmot/blob/main/LICENSE).
