// Price Widget — Scriptable script
//
// SETUP:
// 1. Install "Scriptable" from the App Store (free).
// 2. Open Scriptable, create a new script, paste this whole file in, name it "PriceWidget".
// 3. Edit DATA_URL below to point at your GitHub repo's raw prices.json.
// 4. Long-press your Home Screen -> tap + -> find "Scriptable" -> choose the
//    "Large" size (the biggest size iPhone currently supports until
//    Scriptable adds the new iOS 27 extra-large widget) -> add it.
// 5. Tap the new widget -> pick "PriceWidget" as its script.
//
// NOTE ON SCROLLING: Home Screen widgets can never scroll -- this is an iOS
// platform restriction, not a Scriptable limitation. To work around it, the
// widget shows a condensed view (top gas stations only), and TAPPING the
// widget opens Scriptable and shows a full scrollable list of everything,
// including every gas station, via a native table view.
//
// The widget re-checks this URL each time iOS refreshes it (roughly every
// 15-60+ min, iOS decides the exact cadence). Your data only actually changes
// every couple hours (whenever the GitHub Action runs), so that's fine.

const DATA_URL = "https://raw.githubusercontent.com/JP011098/price-widget/main/data/prices.json";
const MAX_GAS_ROWS_IN_WIDGET = 6;

// --- Trigger GitHub Action on every refresh ---
// GitHub's own hourly cron schedule has been unreliable for this repo, so
// the widget itself asks GitHub to run the fetch workflow via its API each
// time it refreshes. This doesn't change what's shown THIS refresh (the
// Action takes ~15s to run), but keeps data updating on the next refresh
// without depending on GitHub's cron. Requires a one-time GitHub personal
// access token, entered once when you open the script directly (not from
// the widget) and stored securely in this device's Keychain.
const GITHUB_OWNER = "JP011098";
const GITHUB_REPO = "price-widget";
const GITHUB_WORKFLOW_FILE = "update-prices.yml";
const GITHUB_PAT_KEY = "price_widget_github_pat";

async function ensureGitHubPAT() {
  if (Keychain.contains(GITHUB_PAT_KEY)) return;
  const alert = new Alert();
  alert.title = "GitHub Access Token";
  alert.message =
    "Paste your fine-grained GitHub personal access token (Actions: Read and write, scoped to the price-widget repo). Stored securely on this device only -- never shown or sent anywhere except GitHub's API.";
  alert.addTextField("ghp_... or github_pat_...");
  alert.addAction("Save");
  alert.addCancelAction("Skip");
  try {
    await alert.presentAlert();
    const token = alert.textFieldValue(0).trim();
    if (token) Keychain.set(GITHUB_PAT_KEY, token);
  } catch (e) {
    // Skipped -- will ask again next time the script is opened directly.
  }
}

async function triggerGitHubWorkflow() {
  if (!Keychain.contains(GITHUB_PAT_KEY)) return;
  const token = Keychain.get(GITHUB_PAT_KEY);
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`;
  const req = new Request(url);
  req.method = "POST";
  req.headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  req.body = JSON.stringify({ ref: "main" });
  try {
    await req.load();
  } catch (e) {
    // Ignore failures (offline, expired token, etc.) -- next refresh retries.
  }
}

// --- Frosted wallpaper background (optional) ---
// If a file named exactly this exists in Scriptable's Documents folder, it's
// used as the widget's background (a cropped screenshot of your own Home
// Screen at the widget's exact spot), with a translucent dark overlay on top
// for text readability -- similar to Apple's own Batteries widget look.
// Re-crop and replace this file if you change wallpaper or move the widget.
// If the file isn't present, the widget falls back to a plain card.
const BACKGROUND_IMAGE_NAME = "price-widget-bg.jpg";
const OVERLAY_COLOR = new Color("#000000", 0.45); // tweak alpha (0-1) to taste
const OVERLAY_CORNER_RADIUS = 22;

const CURRENCY_FLAGS = { CAD: "🇨🇦", INR: "🇮🇳" };
const GREEN = new Color("#30d158");
const GRAY_LIGHT = new Color("#8e8e93");

// Mutable: createWidget() switches these to light variants when a frosted
// wallpaper background is active, since a dark overlay needs light text
// regardless of system light/dark mode.
let TEXT_PRIMARY = Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f7"));
let TEXT_SECONDARY = Color.dynamic(new Color("#3c3c43"), new Color("#aeaeb2"));
let DIVIDER_COLOR = Color.dynamic(new Color("#e5e5ea"), new Color("#3a3a3c"));

async function getBackgroundImage() {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.documentsDirectory(), BACKGROUND_IMAGE_NAME);
    if (fm.fileExists(path)) {
      return fm.readImage(path);
    }
  } catch (e) {
    // ignore -- falls back to plain card
  }
  return null;
}

async function getData() {
  try {
    const req = new Request(DATA_URL + "?t=" + Date.now()); // cache-bust
    return await req.loadJSON();
  } catch (e) {
    return null;
  }
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(decimals);
}

function timeAgo(isoString) {
  if (!isoString) return "no data yet";
  const then = new Date(isoString);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

// ---------- Widget (condensed, Home Screen) ----------

function addSectionTitle(stack, emoji, text) {
  const row = stack.addStack();
  row.layoutHorizontally();
  const t = row.addText(`${emoji}  ${text}`);
  t.font = Font.boldSystemFont(15);
  t.textColor = TEXT_PRIMARY;
}

function addDivider(stack) {
  stack.addSpacer(4);
  const line = stack.addStack();
  line.size = new Size(0, 1);
  line.backgroundColor = DIVIDER_COLOR;
  stack.addSpacer(4);
}

function addRow(stack, label, value, opts = {}) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const l = row.addText(label);
  l.font = opts.highlight ? Font.semiboldSystemFont(13) : Font.systemFont(13);
  l.textColor = opts.highlight ? GREEN : TEXT_SECONDARY;
  l.lineLimit = 1;
  row.addSpacer();
  const v = row.addText(value);
  v.font = Font.semiboldSystemFont(13);
  v.textColor = opts.highlight ? GREEN : TEXT_PRIMARY;
}

async function createWidget(data) {
  const w = new ListWidget();
  const bgImage = await getBackgroundImage();

  let content = w;
  if (bgImage) {
    w.backgroundImage = bgImage;
    w.setPadding(6, 6, 6, 6);
    // Frosted translucent card sitting on top of the wallpaper crop, similar
    // to Apple's own Batteries widget look.
    content = w.addStack();
    content.backgroundColor = OVERLAY_COLOR;
    content.cornerRadius = OVERLAY_CORNER_RADIUS;
    content.setPadding(12, 12, 12, 12);
    content.layoutVertically();
    // Light text reads well against the dark translucent overlay regardless
    // of the underlying wallpaper or system light/dark mode.
    TEXT_PRIMARY = Color.white();
    TEXT_SECONDARY = new Color("#e5e5ea");
    DIVIDER_COLOR = new Color("#ffffff", 0.25);
  } else {
    w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
    w.setPadding(14, 14, 14, 14);
  }

  const header = content.addStack();
  header.layoutHorizontally();
  const title = header.addText("💰 Prices");
  title.font = Font.boldSystemFont(17);
  title.textColor = TEXT_PRIMARY;
  header.addSpacer();
  const updated = header.addText(data ? timeAgo(data.updated_at) : "no data yet");
  updated.font = Font.systemFont(11);
  updated.textColor = GRAY_LIGHT;

  content.addSpacer(8);

  if (!data) {
    const errText = content.addText("Could not load prices.");
    errText.textColor = TEXT_PRIMARY;
    return w;
  }

  const metals = data.metals || {};
  const metalNames = Object.keys(metals);

  metalNames.forEach((metalName, idx) => {
    const emoji = metalName === "Gold" ? "🥇" : metalName === "Silver" ? "🥈" : "🔩";
    addSectionTitle(content, emoji, metalName);
    const byCurrency = metals[metalName];
    for (const currency of Object.keys(byCurrency)) {
      const flag = CURRENCY_FLAGS[currency] || currency;
      const units = byCurrency[currency];
      for (const unitLabel of Object.keys(units)) {
        addRow(content, `${flag} ${unitLabel}`, `${currency} ${fmt(units[unitLabel])}`);
      }
    }
    if (idx < metalNames.length - 1 || data.gas) addDivider(content);
  });

  if (data.gas) {
    addSectionTitle(content, "⛽", "Gas — Calgary area");
    if (data.gas.stations && data.gas.stations.length) {
      const shown = data.gas.stations.slice(0, MAX_GAS_ROWS_IN_WIDGET);
      shown.forEach((station, i) => {
        addRow(content, station.display_name || station.name, `CAD ${fmt(station.price, 3)}`, {
          highlight: i === 0,
        });
      });
      const remaining = data.gas.stations.length - shown.length;
      if (remaining > 0) {
        content.addSpacer(2);
        const hint = content.addText(`+${remaining} more — tap to view all`);
        hint.font = Font.italicSystemFont(10);
        hint.textColor = GRAY_LIGHT;
      }
    } else if (data.gas.value !== undefined) {
      addRow(content, "Regular (per L)", `CAD ${fmt(data.gas.value, 3)}`);
      if (data.gas.source === "nrcan_weekly_fallback") {
        const note = content.addText("weekly avg (fallback source)");
        note.font = Font.italicSystemFont(10);
        note.textColor = GRAY_LIGHT;
      }
    }
  }

  content.addSpacer();

  // Hint to iOS that it's worth checking again in ~30 minutes. iOS decides
  // the actual refresh cadence and may not honor this exactly, but it
  // generally helps nudge more frequent updates than the default.
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  return w;
}

// ---------- Full detail (scrollable, opens when widget is tapped) ----------

async function presentFullDetail(data) {
  const table = new UITable();
  table.showSeparators = true;

  function addHeaderRow(text) {
    const row = new UITableRow();
    row.isHeader = true;
    row.dismissOnSelect = false;
    row.addText(text);
    table.addRow(row);
  }

  function addTwoColumnRow(label, value, opts = {}) {
    const row = new UITableRow();
    row.dismissOnSelect = false;
    if (opts.highlight) row.backgroundColor = new Color("#30d158", 0.12);
    const left = row.addText(label);
    left.widthWeight = 68;
    const right = row.addText(value);
    right.widthWeight = 32;
    right.rightAligned();
    if (opts.highlight) {
      right.titleColor = GREEN;
      left.titleColor = GREEN;
    }
    table.addRow(row);
  }

  if (!data) {
    addHeaderRow("Could not load prices");
    await table.present(true);
    return;
  }

  addHeaderRow(`💰 Prices — updated ${timeAgo(data.updated_at)}`);

  const metals = data.metals || {};
  for (const metalName of Object.keys(metals)) {
    const emoji = metalName === "Gold" ? "🥇" : metalName === "Silver" ? "🥈" : "🔩";
    addHeaderRow(`${emoji} ${metalName}`);
    const byCurrency = metals[metalName];
    for (const currency of Object.keys(byCurrency)) {
      const flag = CURRENCY_FLAGS[currency] || currency;
      const units = byCurrency[currency];
      for (const unitLabel of Object.keys(units)) {
        addTwoColumnRow(`${flag} ${unitLabel}`, `${currency} ${fmt(units[unitLabel])}`);
      }
    }
  }

  if (data.gas) {
    if (data.gas.stations && data.gas.stations.length) {
      addHeaderRow(`⛽ Gas — Calgary area (${data.gas.stations.length} stations)`);
      data.gas.stations.forEach((station, i) => {
        addTwoColumnRow(
          station.display_name || station.name,
          `CAD ${fmt(station.price, 3)}`,
          { highlight: i === 0 }
        );
      });
    } else if (data.gas.value !== undefined) {
      addHeaderRow("⛽ Gas — Calgary area");
      addTwoColumnRow("Regular (per L)", `CAD ${fmt(data.gas.value, 3)}`);
      if (data.gas.source === "nrcan_weekly_fallback") {
        addTwoColumnRow("Source", "weekly avg (fallback)");
      }
    }
  }

  await table.present(true);
}

// ---------- Entry point ----------

const data = await getData();

// Set up the token once, only when opened directly (widgets can't show
// interactive prompts). Then ask GitHub to run the fetch workflow now, so
// the *next* refresh has fresher data than this one.
if (!config.runsInWidget) {
  await ensureGitHubPAT();
}
await triggerGitHubWorkflow();

if (config.runsInWidget) {
  const widget = await createWidget(data);
  Script.setWidget(widget);
} else {
  // Opened by tapping the widget (or run manually in the app) -- show the
  // full scrollable detail view instead of just re-showing the widget preview.
  await presentFullDetail(data);
}
Script.complete();
