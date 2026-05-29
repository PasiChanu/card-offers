// build.js — reads offers.json and injects it into index.html template
const fs = require('fs');
const path = require('path');

const offersPath = path.join(__dirname, 'offers.json');
const templatePath = path.join(__dirname, 'index.template.html');
const outputPath = path.join(__dirname, '..', 'index.html');

if (!fs.existsSync(offersPath)) {
  console.error('❌ offers.json not found. Run scrape.js first.');
  process.exit(1);
}

let offers = JSON.parse(fs.readFileSync(offersPath, 'utf8'));

// Sanitize offers
offers = offers.map((o, i) => ({
  id: i + 1,
  bank:   sanitize(o.bank   || 'Unknown'),
  cat:    sanitize(o.cat    || 'Other'),
  title:  sanitize(o.title  || 'Offer'),
  desc:   sanitize(o.desc   || ''),
  disc:   sanitize(o.disc   || 'Special offer'),
  expiry: o.expiry || '2026-12-31',
  url:    sanitize(o.url    || '')
}));

function sanitize(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, "'")
    .replace(/\${/g, '\\${')
    .slice(0, 500);
}

// Build SEED JS
const seedLines = offers.map(o =>
  `  {id:${o.id},bank:${JSON.stringify(o.bank)},cat:${JSON.stringify(o.cat)},title:${JSON.stringify(o.title)},desc:${JSON.stringify(o.desc)},disc:${JSON.stringify(o.disc)},expiry:${JSON.stringify(o.expiry)},url:${JSON.stringify(o.url)}}`
);
const seedJS = `const SEED=[\n${seedLines.join(',\n')}\n];`;

// Inject into template
let html = fs.readFileSync(templatePath, 'utf8');
html = html.replace(/const SEED=\[[\s\S]*?\];/, seedJS);

// Stamp last updated date
const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
html = html.replace('{{LAST_UPDATED}}', now);

fs.writeFileSync(outputPath, html);
console.log(`✅ Built index.html with ${offers.length} offers (Last updated: ${now})`);
