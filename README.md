# PulseSurvey - Web-based Internal Survey Platform

PulseSurvey is a lightweight internal employee feedback and engagement platform.

## Delivered capabilities

### 1) Survey Creation Module
- Admin can create surveys, edit draft data (via JSON payload), and publish surveys.
- Supported question types:
  - Rating scale
  - Dropdown selection
  - Multiple-choice list
  - Open text response

### 2) Response Management
- Surveys are distributed using employee email IDs via invitation list (`email,name` per line).
- Supports 50+ respondents per survey (no hard-coded low cap).
- Strict one-response-per-email-per-survey enforcement.
- Captures respondent name and response values.
- Tracks status as `pending`/`completed`.

### 3) Access Control & Permissions
- Passwordless login with email-only magic-link flow.
- Admins can:
  - View all responses
  - Access participation reports
  - Generate full analytics and exports
- Regular users can:
  - Access only invited surveys
  - Submit and view only their own report (if enabled)

### 4) Reporting & Analytics
- Aggregated summaries by question.
- Question-wise analysis in admin survey/report views.
- Respondent-level data for admins.
- Dashboard metrics include participation and completion indicators.

### 5) Data Export & File Generation
- Export endpoints:
  - `.xlsx`
  - `.pdf`
  - `.pptx`
- Exports include summary + respondent-level rows (admin-only).

### 6) UX & Design
- Gamified theme and modern dark gradient UI.
- Interactive forms and dashboards for admin/employees.

## Tech stack
- Node.js built-in HTTP server
- File-based JSON persistence (`data.json`)
- Cookie session map in-process

## Run

```bash
node server.js
```

Open: `http://localhost:5000`

## Demo admin login
Use an email ending with `@admin.local` (example: `leader@admin.local`).
