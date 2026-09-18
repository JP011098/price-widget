// Price Widget — Scriptable script
//
// SETUP:
// 1. Install "Scriptable" from the App Store (free).
// 2. Open Scriptable, create a new script, paste this whole file in, name it "PriceWidget".
// 3. Edit DATA_URL below to point at your GitHub repo's raw prices.json.
// 4. Long-press your Home Screen -> tap + -> find "Scriptable" -> choose the
//    "Large" size (that's the biggest widget size iPhone supports — there is
//    no true "full screen" widget on iPhone, Large is the max) -> add it.
// 5. Tap the new widget -> pick "PriceWidget" as its script.
//
// The widget re-checks this URL each time iOS refreshes it (roughly every
// 15-60+ min, iOS decides the exact cadence). Your data only actually changes
// every couple hours (whenever the GitHub Action runs), so that's fine.

const DATA_URL = "https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/data/prices.json";

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

function addSectionTitle(stack, text) {
  const t = stack.addText(text);
  t.font = Font.boldSystemFont(15);
  t.textColor = Color.dynamic(new Color("#222222"), new Color("#eeeeee"));
}

function addRow(stack, label, value) {
  const row = stack.addStack();
  row.layoutHorizontally();
  const l = row.addText(label);
  l.font = Font.systemFont(13);
  l.textColor = Color.dynamic(new Color("#555555"), new Color("#aaaaaa"));
  row.addSpacer();
  const v = row.addText(value);
  v.font = Font.boldSystemFont(13);
}

async function createWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  w.setPadding(14, 14, 14, 14);

  const header = w.addStack();
  header.layoutHorizontally();
  const title = header.addText("💰 Prices");
  title.font = Font.boldSystemFont(17);
  header.addSpacer();
  const updated = header.addText(data ? timeAgo(data.updated_at) : "no data yet");
  updated.font = Font.systemFont(11);
  updated.textColor = Color.gray();

  w.addSpacer(8);

  if (!data) {
    w.addText("Could not load prices.");
    return w;
  }

  const metals = data.metals || {};

  for (const metalName of Object.keys(metals)) {
    addSectionTitle(w, metalName);
    const byCurrency = metals[metalName];
    for (const currency of Object.keys(byCurrency)) {
      const units = byCurrency[currency];
      for (const unitLabel of Object.keys(units)) {
        addRow(w, `${unitLabel} (${currency})`, `${currency} ${fmt(units[unitLabel])}`);
      }
    }
    w.addSpacer(6);
  }

  if (data.gas) {
    addSectionTitle(w, "⛽ Gas — Calgary area");
    if (data.gas.stations && data.gas.stations.length) {
      // Individual stations, cheapest first (already sorted by fetch script).
      for (const station of data.gas.stations) {
        addRow(w, station.display_name || station.name, `CAD ${fmt(station.price, 3)}`);
      }
    } else if (data.gas.value !== undefined) {
      addRow(w, "Regular (per L)", `CAD ${fmt(data.gas.value, 3)}`);
      if (data.gas.source === "nrcan_weekly_fallback") {
        const note = w.addText("weekly avg (fallback source)");
        note.font = Font.italicSystemFont(10);
        note.textColor = Color.gray();
      }
    }
  }

  w.addSpacer();
  return w;
}

const data = await getData();
const widget = await createWidget(data);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
