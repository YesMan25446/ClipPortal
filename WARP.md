# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project overview
- This is a static web prototype for submitting video clips. There is no build step, package manager, or test/lint tooling configured. Development is done directly against index.html, styles.css, and script.js.

Common commands (Windows PowerShell)
- Serve the site locally (recommended for CORS/file API parity):
  - If Python is installed:
    - py -m http.server 5173
    - Then open http://localhost:5173
    - Stop with Ctrl+C
  - If Node.js is installed (and npx available):
    - npx serve .
    - Then open the URL printed (usually http://localhost:3000)
- Open directly in a browser (works for simple viewing, but some APIs behave differently from file://):
  - Start-Process .\index.html

Build, lint, and tests
- Build: Not applicable (pure static files, no bundler)
- Lint: Not configured
- Tests: Not configured

High-level architecture
- Page structure (index.html)
  - Header: Sticky site header with logo and simple nav links (Submit, Guidelines)
  - Main content:
    - Submit section: Card containing the submission form (#clipForm) with fields for title (required), optional video URL, optional file upload (video/*), optional category, and optional description. Form uses semantic labels and helper text small elements with data-for for field-level error messaging.
    - Guidelines section: Card listing submission guidelines
  - Footer: Displays the current year (populated dynamically) and site name
  - Assets: Loads Inter font from Google Fonts; links styles.css and defers script.js

- Styling (styles.css)
  - Theming via CSS custom properties: --bg, --panel, --accent, --text, --muted, --error, --border
  - Layout primitives: .container for centered content; .card panels with subtle gradient, border, and shadow; .grid for 2-column form layout with responsive collapse at <=720px; .span-2 utility to span full width in the grid
  - Form controls: Consistent background, border, focus ring, and error/hint areas. .error small reserves height to prevent layout shift
  - Components: .site-header (backdrop blur, sticky), .site-footer, .btn (primary variant as gradient)

- Client behavior (script.js)
  - Encapsulated IIFE to avoid globals
  - DOM references by id (#clipForm, #title, #url, #file, #year)
  - Footer year populated at runtime
  - Validation on submit:
    - Title is required (non-empty)
    - If URL provided, it must parse as a valid URL (using URL constructor)
    - At least one of URL or File is required
    - Error messages are mapped via small.error[data-for="<id>"] elements
  - Prototype submission flow:
    - Collects FormData, converts to an object for preview, replaces File object with its name for alert output
    - Alerts the captured payload (no network calls) and resets the form

Extension points (for future work)
- Backend integration: Replace the alert() with a fetch() POST to your API or serverless endpoint. Use FormData to preserve file uploads without manual serialization. Keep the required-field and URL validations; add any backend constraints server-side as well.
- File uploads: If moving beyond prototype, enforce file size/type constraints client-side and server-side. Consider upload progress UI for large files.

Important notes from README
- This is a static prototype; hook the form up to your backend or serverless endpoint to process submissions.
- Primary files: index.html (page + form), styles.css (layout/themes), script.js (interactivity/validation). Place static assets (images, etc.) under assets/.
