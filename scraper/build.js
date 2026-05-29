const fs   = require('fs');
const path = require('path');

// __dirname = /home/runner/work/card-offers/card-offers/scraper
// repoRoot  = /home/runner/work/card-offers/card-offers
const repoRoot     = path.resolve(__dirname, '..');
const offersPath   = path.resolve(__dirname, 'offers.json');
const templatePath = path.resolve(repoRoot,  'index.template.html');
const outputPath   = path.resolve(repoRoot,  'index.html');

console.log('Paths:');
console.log('  repoRoot    :', repoRoot);
console.log('  offersPath  :', offersPath);
console.log('  templatePath:', templatePath);
console.log('  outputPath  :', outputPath);

if (!fs.existsSync(offersPath)) {
  console.error('ERROR: offers.json not found at', offersPath);
  process.exit(1);
}
if (!fs.existsSync(templatePath)) {
  console.error('ERROR: index.template.html not found at', templatePath);
  console.error('Files in repoRoot:', fs.readdirSync(repoRoot).join(', '));
  process.exit(1);
}

let offers = JSON.parse(fs.readFileSync(offersPath, 'utf8'));

function sanitize(str) {
  return String(str || '').replace(/\\/g,'\\\\').replace(/`/g,"'").replace(/\${/g,'\\${').slice(0,500);
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

const seedLines = offers.map(o =>
  `  {id:${o.id},bank:${JSON.stringify(o.bank)},cat:${JSON.stringify(o.cat)},` +
  `title:${JSON.stringify(o.title)},desc:${JSON.stringify(o.desc)},` +
  `disc:${JSON.stringify(o.disc)},expiry:${JSON.stringify(o.expiry)},url:${JSON.stringify(o.url)}}`
);
const seedJS = `const SEED=[\n${seedLines.join(',\n')}\n];`;

let html = fs.readFileSync(templatePath, 'utf8');

if (!html.includes('const SEED=[')) {
  console.error('ERROR: "const SEED=[" marker not found in template.');
  process.exit(1);
}

html = html.replace(/const SEED=\[[\s\S]*?\];/, seedJS);
const now = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
html = html.replace(/\{\{LAST_UPDATED\}\}/g, now);

fs.writeFileSync(outputPath, html);
console.log('Built index.html with', offers.length, 'offers. Updated:', now);
