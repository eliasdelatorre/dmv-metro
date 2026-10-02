# Metro Board

A split-flap style board showing upcoming DC Metro trains for any station you pick.

- `src/index.js` is the Cloudflare Worker. It keeps your WMATA key private and caches responses.
- `public/` is the board page (HTML, CSS, JavaScript).
- `wrangler.toml` is the project config.

## 1. Add your WMATA key for local testing

Copy `.dev.vars.example` to a new file named `.dev.vars` and replace the placeholder with your key:

    WMATA_KEY=your-real-key

`.dev.vars` stays on your computer only (it is listed in `.gitignore`).

## 2. Preview locally

From this folder, in a terminal:

    wrangler dev

Open http://localhost:8787 in your browser. Edits to files reload automatically.

## 3. Deploy to Cloudflare

Store the key on Cloudflare once (you'll be prompted to paste it, it is not echoed):

    wrangler secret put WMATA_KEY

Then deploy:

    wrangler deploy

The first deploy may ask you to register a workers.dev subdomain. Your board will then be at
`https://metro-board.<your-subdomain>.workers.dev`.

If `wrangler secret put` says the Worker doesn't exist yet, run `wrangler deploy` first, then `wrangler secret put WMATA_KEY` again.

## Using it

- Pick a station from the dropdown. The choice is saved in the URL (`?station=A01`) and in the browser.
- **Nearest** selects the closest station using your device location.
- **Full screen** fills the display. Controls fade out after a few seconds without mouse movement.
- For a wall display, open `https://.../?station=A01&kiosk=1` to hide the controls entirely.
  On a Raspberry Pi: `chromium --kiosk "https://.../?station=A01&kiosk=1"`.

## Notes

- Transfer stations (Metro Center, L'Enfant Plaza, Gallery Place, Fort Totten) are merged so both platform levels show together.
- Predictions refresh every 20 seconds and are cached for 15 seconds on the Worker, far below the 50,000 calls/day free limit.
- Destination names are cut to 18 characters (for example "Franconia-Springfield" shows as "FRANCONIA-SPRINGFI").
