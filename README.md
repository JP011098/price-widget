# Price Widget

Tracks gold & silver (CAD from GoldAPI, INR scraped from goodreturns.in) and
Calgary-area gas prices (CAD, Google Places with an NRCan fallback), shown
on your iPhone Home Screen.

## How it works

```
GitHub Actions (runs every hour)
   -> scripts/fetch_prices.py
   -> reads config/products.json          (what to track)
   -> CAD gold/silver:  GoldAPI.io          (every 12h, quota-limited)
   -> INR gold/silver:  scrapes goodreturns.in
   -> gas:              Google Places, falls back to NRCan weekly data
   -> writes data/prices.json
   -> commits it to this repo

Scriptable widget on your iPhone
   -> reads data/prices.json from GitHub (raw file, public URL)
   -> displays it
```

## Why two different sources for gold/silver

CAD uses GoldAPI's international spot price (converted to per-10g at 24K/22K
purity, and per-kg for silver) -- there's no equivalent "real Canadian retail
price" concept the way there is in India.

INR uses goodreturns.in directly, because actual Indian retail gold/silver
prices include import duty, GST, and dealer premiums that a spot-price
conversion would miss. goodreturns.in has no official API, so this is a
scrape of their public gold/silver rate pages -- **you accepted the
tradeoffs of this going in**: it's not clearly authorized by their terms,
and it can break if they change their page layout. The current parsing
patterns were verified against a real page dump from September 2026
(`24K Gold /g ₹15,442`, `22K Gold /g ₹14,155`, `Silver /g ₹250`,
`Silver /kg ₹2,50,000`, all confirmed against the site's own per-10g table).
If it stops working later, open https://www.goodreturns.in/gold-rates/ and
https://www.goodreturns.in/silver-rates/, save the page text, and update the
regex in `fetch_metals_inr_goodreturns()` in `scripts/fetch_prices.py` to
match the current wording.

## One-time setup

### 1. Create the GitHub repo
Create a **public** repo (the widget reads a public raw file with no auth --
keep it public, but note your prices data isn't sensitive info anyway).
Push these files to it.

### 2. Get a GoldAPI key (free)
- Go to https://www.goldapi.io, sign in with Google, copy your API key.
- Free tier: **100 requests/month**. CAD gold + silver = 2 requests per
  fetch. To stay comfortably under quota, `fetch_prices.py` only actually
  calls GoldAPI once every 12 hours (2 runs/day x 2 requests x 30 days =
  120/month -- still a bit over, so consider bumping
  `cad_refresh_every_hours` to 16 or 24 in `config/products.json` if you
  want more headroom; daily updates for CAD metals is a very reasonable
  default for a personal dashboard).
- INR prices (scraped) and gas (Google Places) aren't affected by this and
  refresh every hourly run regardless.

### 3. Get a Google Maps API key
- Go to https://console.cloud.google.com, create a project, enable "Places API (New)".
- Create an API key, restrict it to Places API for safety.
- Requires a billing account (card on file), but usage this light stays
  within the $200/month free credit.
- If Google returns no station prices for Calgary (coverage can be spotty),
  the script automatically falls back to Natural Resources Canada's public
  weekly average -- you'll still get a number either way.

### 4. Add secrets to GitHub
In your repo: Settings -> Secrets and variables -> Actions -> New repository secret.
Add:
- `GOLDAPI_KEY`
- `GOOGLE_MAPS_KEY`

(No key needed for the goodreturns.in scrape -- it's just an HTTP GET.)

### 5. Turn on the workflow
Go to the Actions tab in your repo, enable workflows if prompted, then run
"Update prices" manually once (Actions -> Update prices -> Run workflow) to
generate the first real `data/prices.json`. Check the run's logs -- this is
where you'll see if the goodreturns scrape or Google Places gas lookup
didn't find what they expected.

### 6. Set up the widget on your iPhone
1. Install **Scriptable** (free, App Store).
2. Open it, tap **+**, paste in `scriptable/PriceWidget.js`, name the script "PriceWidget".
3. Edit the `DATA_URL` constant near the top to:
   `https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/data/prices.json`
4. Long-press your Home Screen -> **+** -> search "Scriptable".
   - On iOS 27 (currently in beta as of writing), Apple added a true
     full-page **extra-large** widget size. Use that if Scriptable has
     added support for it by the time you set this up.
   - Otherwise, choose **Large** -- the biggest size available on earlier
     iOS versions (a 4x4 icon area).
5. Add it, tap it once, and set its script to "PriceWidget".

## Adding or removing a tracked item later

Edit `config/products.json`:
- To add a metal for CAD: add an entry to `metals.items` with its standard
  symbol (`XAU` gold, `XAG` silver, `XPT` platinum, `XPD` palladium) and
  whatever units you want (grams, purity). Note this only applies to the
  CAD/GoldAPI path -- the INR/goodreturns path is hardcoded to gold + silver
  since that's what goodreturns.in publishes.
- To turn off gas entirely: set `"gas": { "enabled": false, ... }`.
- To change how often CAD metals refresh: edit `cad_refresh_every_hours`.

Commit the change, and the next Action run picks it up automatically.

## Notes / caveats
- **goodreturns.in scrape**: not an official API, can break without notice,
  and its use here isn't clearly sanctioned by their terms of service --
  you chose this tradeoff for more accurate Indian retail rates. Revisit if
  it becomes unreliable.
- **Gas price coverage** from Google depends on which Calgary-area stations
  report prices to Google -- it may be a handful of stations, not all of them.
- The **NRCan fallback** only updates weekly (it's the official government
  survey), so if Google has no data for a while, the gas number will look
  "stuck" for up to a week.
- **CAD metals update at most every 12 hours** (quota-limited), while INR
  metals and gas refresh every hour the Action runs.
- iOS decides exactly when to actually refresh widgets on-screen (typically
  every 15-60+ minutes), independent of how often the underlying data changes.
