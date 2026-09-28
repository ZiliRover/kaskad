<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Kaskad: a node studio that chains prompts, images and 80+ AI models into video pipelines">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-0e0f12?logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React_Flow-12-0e0f12?logo=react&logoColor=7dd3fc" alt="React Flow 12">
  <img src="https://img.shields.io/badge/TypeScript-5.9-0e0f12?logo=typescript&logoColor=7dd3fc" alt="TypeScript 5.9">
  <img src="https://img.shields.io/badge/PostgreSQL-queue-0e0f12?logo=postgresql&logoColor=white" alt="PostgreSQL job queue">
  <img src="https://img.shields.io/badge/OpenRouter-84_models-0e0f12" alt="84 OpenRouter models">
  <img src="https://img.shields.io/badge/status-early_core-d7f75b?labelColor=0e0f12" alt="Status: early core">
</p>

<p align="center">
  <b>Kaskad</b> (working name) is a web studio for AI video and images.<br>
  Drop nodes on a canvas, wire them together, see the price before you run, and let a server-side queue do the rest.
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/readme/studio-dark.png">
  <img src="./assets/readme/studio-light.png" width="100%" alt="The Kaskad studio: a grouped pipeline where scene one is generated with Seedance, its last frame is extracted, scene two starts from that frame, and both clips are joined into one video">
</picture>

<p align="center"><sub>A two-scene video in one graph: scene 1 → last frame → scene 2 → join. Light and dark themes follow your system.</sub></p>

## What it does

- **Every OpenRouter video and image model on one canvas.** 28 video models (Seedance, Veo, Kling, Sora, Wan, Hailuo, Runway…), 53 image models (Nano Banana, GPT Image, Seedream, FLUX, Recraft…) and a few text models for writing prompts.
- **Nodes show exactly what a model accepts.** First and last frame, image references, video and audio references for Seedance 2, a source video for edit and upscale models. Required inputs are marked; wires only connect matching types.
- **Price before you run, pay in rubles.** Every node shows its price in rubles at the daily Central Bank rate. A run reserves its estimate from the prepaid balance and is charged what the provider actually billed; failed generations cost nothing.
- **Sign in with an email code.** No passwords. Every account has its own canvas, files and balance, tops up by card through YooKassa, and gets a welcome bonus to try things.
- **Variants, versions, and what flows next.** Generate up to 4 images at once, click the best one, and that is what the next node receives. Older results stay browsable.
- **Long videos without an editor.** Built-in tools take the last frame of a clip for the next scene and join clips into one video (ffmpeg, free).
- **A studio, not a demo.** Templates, a results gallery you can drag back onto the canvas, prompt improvement and translation, notes and groups, copy/paste, undo for deletions, drop or paste files from your computer.

## Why it's built this way

| | |
| --- | --- |
| **Models come from data, not code** | `npm run models:sync` pulls capabilities and prices from OpenRouter's catalogs. A new model shows up with the right inputs and controls without UI work. |
| **One planner, two places** | The same function prices a run in the browser and builds the executed plan on the server, so the confirmation always matches what runs. |
| **Generations survive anything** | Jobs live in Postgres and run in a separate worker. Closing the tab, reloading or redeploying the web app doesn't stop them; a restarted worker resumes a video by its provider id instead of paying twice. |
| **Money is a ledger** | Balances are never stored, only derived from kopeck entries: hold, release, charge, top-up, bonus. Each job settles exactly once in the same transaction as its result, and a payment credits once no matter how many webhooks arrive. |
| **Failures explain themselves** | If an input node fails or is stopped, every node downstream says which one and why. A failed rerun never erases the previous result. |

<p align="center">
  <img src="./assets/readme/architecture.svg" width="100%" alt="Architecture: the React Flow canvas sends the graph to the Next.js API, which plans and prices the run and queues jobs in Postgres; a separate worker executes them through OpenRouter or local ffmpeg tools and writes results to file storage">
</p>

## Quick start

**Windows, one click:** double-click `start-studio.bat`. The first run installs dependencies and creates `.env`; then the studio opens in your browser. Running it again while the studio is up just opens the browser.

**Any OS:**

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:3000> and sign in with any email: without `SMTP_URL` the code is printed in the server console and shown on the form. `npm run dev` starts three processes:

| Process | Job |
| --- | --- |
| `db` | local Postgres from the embedded-postgres binaries, data in `.pgdata/`, migrations applied on start |
| `web` | Next.js: the canvas and the API |
| `worker` | takes generation jobs from the queue |

Requirements: Node.js 20+, and `ffmpeg`/`ffprobe` on `PATH` for the video tools.

> [!NOTE]
> The studio starts in **test mode** (`PROVIDER_MODE=mock`): generations are placeholders, balances move by the estimate, and a badge in the header says so. Top-ups use a local test checkout (`PAYMENTS_PROVIDER=test`) where no money moves. Put your key in `KASKAD_OPENROUTER_KEY` and set `PROVIDER_MODE=live` for real generations, which are billed to your OpenRouter balance.

<details>
<summary><b>Environment variables</b></summary>

| Variable | Default | Purpose |
| --- | --- | --- |
| `KASKAD_OPENROUTER_KEY` | | server-side key, never sent to the browser. Project-specific name so a machine-wide `OPENROUTER_API_KEY` from other tools can't override it |
| `PROVIDER_MODE` | `mock` | `live` for real OpenRouter calls |
| `DATABASE_URL` | local dev Postgres | any Postgres 15+ in production |
| `STORAGE_DIR` | `./storage` | uploads and results (S3-compatible storage is planned) |
| `MOCK_VIDEO_PATH` | | sample mp4 returned by test-mode video models |
| `WORKER_CONCURRENCY` | `4` | parallel jobs per worker |
| `USD_RUB_FALLBACK` | `85` | rate used if the Central Bank feed is unreachable |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | custom ffmpeg location |
| `BLOCKED_VENDORS` | | vendors that refuse the server's region, e.g. `google` from Russia; their models are marked unavailable |
| `PUBLIC_BASE_URL` | | public https address of the server; providers download video/audio inputs by signed link |
| `FILE_URL_SECRET` | derived | secret for those signed links |
| `ADMIN_EMAILS` | | operators: generate without a balance limit and see the OpenRouter balance instead of their own |
| `PRICE_MARKUP` | `1.5` | user price = provider cost × Central Bank rate × markup |
| `WELCOME_BONUS_RUB` | `50` | credited once to each new account |
| `SMTP_URL` / `MAIL_FROM` | | mail for login codes (`smtps://user:pass@host:465`); without it, dev prints codes to the console |
| `PAYMENTS_PROVIDER` | `test` in dev | `yookassa` for real payments; webhook: `<APP_URL>/api/payments/webhook` |
| `YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET_KEY` | | YooKassa shop credentials |
| `APP_URL` | `PUBLIC_BASE_URL` | where the checkout returns the user |

</details>

## Using the studio

- **Add a model:** drag it from the left panel onto the canvas. Search by name or filter by what you need: frames, references, video/audio references, sound, variants.
- **Swap a model:** drag another model of the same kind onto an existing node. Wires and compatible settings are kept.
- **Bring your files:** drop images, videos or audio anywhere on the canvas, or paste them with <kbd>Ctrl</kbd>+<kbd>V</kbd>.
- **Start from a template:** *Templates* in the header adds a ready chain next to your work: product card and video, idea → frame → video, character from references, two-scene video, restyle an image, video upscale.

| Shortcut | Action |
| --- | --- |
| <kbd>Delete</kbd> | delete selection |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | bring back the last deletion |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd> | copy and paste nodes with their wires |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | duplicate selection |
| <kbd>Ctrl</kbd>+<kbd>G</kbd> | frame the selection in a group |

Shortcuts use physical keys, so they work in any keyboard layout.

## Models

| Group | Count | Examples |
| --- | ---: | --- |
| Video generation | 25 | Seedance 2.0 / 2.5, Veo 3.1, Kling 3.0, Sora 2 Pro, Wan 3.0, Hailuo 3, Runway Gen-4.5 |
| Video edit and upscale | 3 | FLUX Video Edit, Runway Aleph 2, FLUX Video Upscale |
| Image generation | 44 | Nano Banana Pro / 2, GPT Image 2, Seedream 5.0, FLUX.2, Qwen Image 3, Recraft V4.1 |
| Style from references | 5 | Recraft V4 Styles, Ming Image Design Layer |
| Vector (SVG) | 4 | Recraft V4 / V4.1 Vector |
| Text | 3 | Gemini 3.8 Flash, Claude Sonnet 5, DeepSeek V4.1 Flash |
| Local tools | 2 | Last frame from video, Join videos |

Refresh the catalog with `npm run models:sync`. `src/lib/models/curation.ts` adds what the catalogs don't publish: display names, which video models accept references, and hidden models.

## Project layout

```text
src/
  app/          pages (studio, login, test checkout) and API routes (auth, billing, payments, graphs, runs, jobs, uploads, files, enhance)
  components/   the studio: canvas, nodes, palette, gallery, templates
  lib/          shared by browser and server: graph schema, planner, models, prices, templates
  server/       database, auth, billing ledger, payments, storage, providers, ffmpeg tools, worker
scripts/        local Postgres, model sync
drizzle/        SQL migrations
prototype/      the original desktop app, kept for reference
```

| Command | |
| --- | --- |
| `npm run dev` | everything for development |
| `npm run models:sync` | pull models and prices from OpenRouter |
| `npm run db:generate` | create a migration after editing `src/server/db/schema.ts` |
| `npm run db:stop` / `npm run db:reset` | stop the local database / recreate it from scratch |
| `npm run typecheck` / `npm run build` | type check / production build |

## Status

This is the core of the product. A live run on real models (GPT Image 2 → Seedance 2.0 Fast → last frame → Seedance 2.0 Mini → join) produced an 8-second video for $0.32, within 4% of the pre-run estimate. What the live run taught us, and what is still open:

- **Google models are blocked from Russia** ("Blocked by Google AI Studio"): Nano Banana, Veo and Gemini need a generation server abroad. Set `BLOCKED_VENDORS=google` meanwhile; OpenAI, Anthropic, ByteDance, Alibaba and others work.
- **Seedance refuses frames that look like a real person** (provider privacy filter). The studio explains this on the node and suggests stylized frames or other models.
- **Video and audio inputs need a public https server address.** Providers accept them only as links, not inline files; without `PUBLIC_BASE_URL` those runs stop before anything is billed.
- **Payments are wired, not yet live.** YooKassa needs a shop (self-employed status works) and a public https address for the webhook; until then top-ups run through the test checkout. Receipts for "Мой налог" come from YooKassa's own integration.
- **Reference limits for video models are estimates.** OpenRouter doesn't publish them; providers report an error on the node if a limit is exceeded.
- **Graph saves are last-write-wins.** Two open tabs of the same graph can overwrite each other.

Next up: hosting (a server abroad for Google models, S3 storage, public https) and the closed beta. The product plan (in Russian) is in [PRODUCT.md](./PRODUCT.md).

## License

Private project. All rights reserved.
