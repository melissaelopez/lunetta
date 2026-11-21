---
trigger: always_on
description: Project guardrails for Lunetta covering production target, visual aesthetic, branding/licensing, security, architecture, and testing.
---

# Project Guardrails
- Production target: Google Cloud Run + Cloud Firestore (single container). Keep the local SQLite storage adapter working for local dev.
- Visual goal: Calm, minimalist Nanit-inspired aesthetic optimized for quick glances on mobile and dark-room nighttime use.
- Branding & Licensing: Rebrand all user-facing text, page titles, app headers, PWA metadata, and package names from "blAIr" to "Lunetta", while preserving the original MIT LICENSE file and copyright notice. Avoid using the word "Nanit" in the app name or public URLs.
- Security: NEVER store, cache, or log Nanit passwords, Nanit session tokens, or user-supplied `X-Gemini-Api-Key` headers in Firestore, SQLite, or console logs.
- Keep the existing pluggable storage and AI provider abstractions intact.
- Add unit tests using anonymized JSON fixtures in `tests/fixtures/` whenever changing sleep scoring or longest-stretch math.
