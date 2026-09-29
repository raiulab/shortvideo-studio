# Shortvideo Studio

A local-first studio for orchestrating image composition, image-to-video generation, provider
comparison, lip sync, extension, download, and cost guardrails across multiple AI media APIs.

This public edition contains only the reusable application. Character profiles, reference images,
generated media, request history, and cost ledgers are runtime data and are intentionally excluded.

## Features

- Character and reference-image management
- Seedream image composition
- Vidu, Runway, Seedance, Veo, Omni, and Hedra adapters
- Side-by-side multi-provider generation
- Text-to-video, image-to-video, start/end frames, and reference-to-video flows
- Lip sync and supported provider-native video extension
- Local concatenation and final-frame extraction with FFmpeg
- Preflight cost estimates and per-request, daily, and monthly limits
- Persistent local history with deletion and cancellation controls
- Gemini-assisted English video prompt ideas

Provider availability, model names, pricing, and API behavior change over time. Review each
provider's current documentation and terms before using the corresponding adapter.

## Quick start

Requirements: Node.js 22 or later. FFmpeg and FFprobe are optional but required for local
concatenation and final-frame extraction.

```bash
cp .env.example .env
# Add only the keys for providers you intend to use.
npm run dev
```

Open <http://127.0.0.1:4173>. Providers without a configured key remain unavailable in the UI.

## Tests

```bash
npm test
```

The tests mock remote requests and do not spend provider credits.

## Runtime data

The following ignored locations are created or populated locally:

- `characters/`: private profiles and reference images
- `data/`: generation history, budget settings, and cost ledgers
- `projects/inputs/`: uploaded start and end frames
- `projects/compositions/`: composed images
- `projects/outputs/`: generated videos
- `public/uploads/`: temporary browser-served uploads

Do not commit these directories. Start with an empty workspace and add only content for which you
hold the required rights.

## Security and cost controls

- API credentials are read only from the server-side `.env` file.
- Uploaded data is size-limited and provider errors are normalized.
- Cost figures are estimates unless a provider returns an actual amount.
- Set conservative limits before enabling a provider.
- Bind the app to a trusted local environment; it is not an authenticated public SaaS server.

## License

Code is licensed under the MIT License. Provider names are used only to describe compatibility.
Media, uploaded assets, generated outputs, and third-party services retain their respective rights
and terms.
