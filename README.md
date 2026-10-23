# Labcorp clinical result view example

This small web app asks for a Junction order ID and shows the current Labcorp clinical report in a layout based on Labcorp's example result report. It reads:

- `GET /v3/order/{order_id}` for the patient details captured on the order
- `GET /v3/order/{order_id}/clinical_report` for the Labcorp-reported patient, specimen, test, result, note, status, and performing lab data

The API key is used only by the local Node server. The browser never calls Junction directly. The app does not write results to disk or store them in a database.

## Run with Junction

Install Node.js 20.6 or newer. There are no npm dependencies to install.

1. In `src/server.js`, replace `PASTE_TEAM_API_KEY_HERE` with a team API key in `localSettings.apiKey`.
2. Set `localSettings.environment` to `sandbox-us`, `sandbox-eu`, `prod-us`, or `prod-eu` for the order you want to view.
3. Run `npm start`.
4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and enter a Junction order ID.

The server sends the key in the `x-vital-api-key` header. The key must be allowed to read the order and its clinical report. An order without a released report shows an unavailable state. The app only listens on `127.0.0.1`.

## Preview without an API key

Run `npm run demo` and submit the prefilled order ID. The two files in `fixtures/` are entirely synthetic. Demo mode does not call Junction.

Run `npm test` for rendering and API request checks.