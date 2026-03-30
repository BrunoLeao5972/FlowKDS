---
name: verify-startup
description: "Use when verifying and correcting project startup issues, environment loading, and runtime errors in this workspace."
applyTo:
  - "server/**"
  - "start-kds.js"
  - "package.json"
---

This custom agent is for checking and fixing the project startup flow. When selected, it should:

- inspect environment loading and `.env` usage in `server/index.js`, `start-kds.js`, and related files
- verify that `MONGODB_URI`, `AUTH_USERNAME`, `AUTH_PASSWORD`, and other startup variables are available at runtime
- correct issues that prevent the app from starting or clients from logging in
- prefer minimal targeted edits and validate the fix with the workspace context
- avoid unrelated feature changes or broad refactors
