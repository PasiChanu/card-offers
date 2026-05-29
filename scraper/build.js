// build.js — reads offers.json and injects it into index.template.html
const fs = require('fs');
const path = require('path');

// Resolve paths relative to repo root (one level up from scraper/)
const repoRoot     = path.join(__dirname, '..');
const offersPath   = path.join(__dirname, 'offers.json');
const templatePath = path.join(repoRoot,  'index.template.html');
const outputPath   = path.join(repoRoot,  'index.html');

// Validate inputs
if (!fs.existsSync(offersPath)) {
  console.error('❌ offers.json not found. Run scrape.js first.');
  process.exit(1);
}
if (!fs.existsSync(templatePath)) {
  console.error(`❌ index.template.html not found at: ${templatePath}`);
  console.error('   Make sure index.template.html is in the ROOT of your repo (not inside scraper/).');
  process.exit(1);
}

// Load & sanitize offers
let offers = JSON.parse(fs.readFileSync(offersPath, 'utf8'));

function sanitize(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, "'")
    .replace(/\${/g, '\\${')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 500);
}

offers = offers.map((o, i) => ({
  id:     i + 1,
  bank:   sanitize(o.bank   || 'Unknown'),
  cat:    sanitize(o.cat    || 'Other'),
  title:  sanitize(o.title  || 'Offer'),
  desc:   sanitize(o.desc   || ''),
  disc:   sanitize(o.disc   || 'Special offer'),
  expiry: o.expiry || '2026-12-31',
  url:    sanitize(o.url    || '')
}));

// Build SEED JS array
const seedLines = offers.map(o =>
  `  {id:${o.id},bank:${JSON.stringify(o.bank)},cat:${JSON.stringify(o.cat)},` +
  `title:${JSON.stringify(o.title)},desc:${JSON.stringify(o.desc)},` +
  `disc:${JSON.stringify(o.disc)},expiry:${JSON.stringify(o.expiry)},url:${JSON.stringify(o.url)}}`
);
const seedJS = `const SEED=[\n${seedLines.join(',\n')}\n];`;

// Read template and inject
let html = fs.readFileSync(templatePath, 'utf8');

// Replace SEED array
if (!html.includes('const SEED=[')) {
  console.error('❌ Could not find "const SEED=[" in index.template.html. Check your template file.');
  process.exit(1);
}
html = html.replace(/const SEED=\[[\s\S]*?\];/, seedJS);

// Replace last-updated placeholder
const now = new Date().toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric'
});
html = html.replace(/{{LAST_UPDATED}}/g, now);

// Write output
fs.writeFileSync(outputPath, html);
console.log(`✅ Built index.html with ${offers.length} offers (Last updated: ${now})`);
console.log(`   Template: ${templatePath}`);
console.log(`   Output:   ${outputPath}`);
