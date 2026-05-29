const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─── Helpers ───────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

async function getPage(browser, url, waitFor = 2000) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(waitFor);
  } catch (e) {
    console.warn(`  ⚠ Timeout/error loading ${url}: ${e.message}`);
  }
  return page;
}

async function closePage(page) {
  try { await page.close(); } catch (e) {}
}

// ─── NDB Bank ──────────────────────────────────────────────────────────────
async function scrapeNDB(browser) {
  console.log('📦 Scraping NDB...');
  const offers = [];
  const BASE = 'https://www.ndbbank.com/cards/card-offers';
  const categories = [
    'restaurants-pubs', 'supermarkets', 'hotels-villas',
    'special-ipp-promotions', 'wellness-beautycare', 'online-stores',
    'travel-transport', 'education', 'automobile', 'fashion-lifestyle',
    'hospitals-healthcare', 'jewellery-watches', 'visa-offers'
  ];

  for (const cat of categories) {
    const url = `${BASE}/${cat}`;
    console.log(`  → ${cat}`);
    const page = await getPage(browser, url, 3000);
    try {
      const items = await page.evaluate(() => {
        const cards = document.querySelectorAll('.offer-card, .card-offer, [class*="offer"], .promotion-card, .promo-card, article');
        const results = [];
        cards.forEach(card => {
          const title = card.querySelector('h2,h3,h4,.title,.offer-title')?.innerText?.trim();
          const desc  = card.querySelector('p,.description,.offer-desc,.content')?.innerText?.trim();
          const disc  = card.querySelector('.discount,.saving,.off,.badge,.tag')?.innerText?.trim();
          const expiry = card.querySelector('.expiry,.valid,.date,.validity')?.innerText?.trim();
          const link  = card.querySelector('a')?.href;
          if (title && title.length > 5) {
            results.push({ title, desc: desc || '', disc: disc || '', expiry: expiry || '', link: link || '' });
          }
        });
        return results;
      });

      // Map category slug to our category names
      const catMap = {
        'restaurants-pubs': 'Dining', 'supermarkets': 'Supermarket',
        'hotels-villas': 'Travel', 'special-ipp-promotions': 'Instalment',
        'wellness-beautycare': 'Health', 'online-stores': 'Online',
        'travel-transport': 'Travel', 'education': 'Instalment',
        'automobile': 'Other', 'fashion-lifestyle': 'Shopping',
        'hospitals-healthcare': 'Health', 'jewellery-watches': 'Shopping',
        'visa-offers': 'Other'
      };

      for (const item of items) {
        offers.push({
          bank: 'NDB',
          cat: catMap[cat] || 'Other',
          title: item.title,
          desc: item.desc,
          disc: item.disc || 'Special offer',
          expiry: parseExpiry(item.expiry),
          url: item.link || url
        });
      }
    } catch (e) {
      console.warn(`    ✗ Parse error: ${e.message}`);
    }
    await closePage(page);
    await delay(1000);
  }
  console.log(`  ✓ NDB: ${offers.length} offers`);
  return offers;
}

// ─── Seylan Bank ───────────────────────────────────────────────────────────
async function scrapeSeylan(browser) {
  console.log('📦 Scraping Seylan...');
  const offers = [];
  const categories = [
    { slug: 'supermarket', cat: 'Supermarket' },
    { slug: 'dining',      cat: 'Dining' },
    { slug: 'local-travel',cat: 'Travel' },
    { slug: 'style',       cat: 'Shopping' },
    { slug: 'auto',        cat: 'Other' },
    { slug: 'insurance',   cat: 'Instalment' },
  ];

  for (const { slug, cat } of categories) {
    let pageNum = 1;
    let hasMore = true;
    while (hasMore) {
      const url = `https://www.seylan.lk/promotions/cards/${slug}?type[]=credit_card&page=${pageNum}`;
      console.log(`  → ${slug} page ${pageNum}`);
      const page = await getPage(browser, url, 3000);
      try {
        const { items, nextExists } = await page.evaluate(() => {
          const cards = document.querySelectorAll('.promotion-item, .promo-card, .offer-card, .card, article, [class*="promo"], [class*="offer"]');
          const items = [];
          cards.forEach(card => {
            const title = card.querySelector('h2,h3,h4,.title')?.innerText?.trim();
            const desc  = card.querySelector('p,.desc,.description')?.innerText?.trim();
            const disc  = card.querySelector('.discount,.savings,.off,.badge')?.innerText?.trim();
            const expiry = card.querySelector('.date,.expiry,.valid,.validity')?.innerText?.trim();
            const link  = card.querySelector('a')?.href;
            if (title && title.length > 5) items.push({ title, desc: desc || '', disc: disc || '', expiry: expiry || '', link: link || '' });
          });
          const next = document.querySelector('.pagination .next:not(.disabled), a[rel="next"], .next-page:not([disabled])');
          return { items, nextExists: !!next };
        });

        for (const item of items) {
          offers.push({
            bank: 'Seylan', cat,
            title: item.title,
            desc: item.desc,
            disc: item.disc || 'Special offer',
            expiry: parseExpiry(item.expiry),
            url: item.link || url
          });
        }
        hasMore = nextExists && items.length > 0;
        pageNum++;
      } catch (e) {
        console.warn(`    ✗ Parse error: ${e.message}`);
        hasMore = false;
      }
      await closePage(page);
      await delay(1000);
    }
  }
  console.log(`  ✓ Seylan: ${offers.length} offers`);
  return offers;
}

// ─── ComBank ───────────────────────────────────────────────────────────────
async function scrapeComBank(browser) {
  console.log('📦 Scraping ComBank...');
  const offers = [];
  const url = 'https://www.combank.lk/rewards-promotions';
  const page = await getPage(browser, url, 4000);
  try {
    // Click "Load More" until it disappears
    let attempts = 0;
    while (attempts < 10) {
      const loadMore = await page.$('.load-more, button[class*="load"], .view-more, .show-more');
      if (!loadMore) break;
      const visible = await loadMore.isIntersectingViewport();
      if (!visible) break;
      await loadMore.click();
      await delay(2000);
      attempts++;
    }
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('.promotion-card, .promo-item, .offer-card, article, [class*="promo"], [class*="offer"]');
      const results = [];
      cards.forEach(card => {
        const title = card.querySelector('h2,h3,h4,.title,.heading')?.innerText?.trim();
        const desc  = card.querySelector('p,.desc,.description,.content')?.innerText?.trim();
        const disc  = card.querySelector('.discount,.saving,.badge,.tag,.off')?.innerText?.trim();
        const expiry = card.querySelector('.date,.expiry,.valid,.validity')?.innerText?.trim();
        const link  = card.querySelector('a')?.href;
        if (title && title.length > 5) results.push({ title, desc: desc || '', disc: disc || '', expiry: expiry || '', link: link || '' });
      });
      return results;
    });
    for (const item of items) {
      const cat = guessCat(item.title + ' ' + item.desc);
      offers.push({
        bank: 'ComBank', cat,
        title: item.title, desc: item.desc,
        disc: item.disc || 'Special offer',
        expiry: parseExpiry(item.expiry),
        url: item.link || url
      });
    }
  } catch (e) { console.warn(`  ✗ ComBank error: ${e.message}`); }
  await closePage(page);
  console.log(`  ✓ ComBank: ${offers.length} offers`);
  return offers;
}

// ─── HNB ───────────────────────────────────────────────────────────────────
async function scrapeHNB(browser) {
  console.log('📦 Scraping HNB...');
  const offers = [];
  const url = 'https://www.hnb.lk/card-promotion';
  const page = await getPage(browser, url, 4000);
  try {
    // Click "Load More" repeatedly
    let attempts = 0;
    while (attempts < 20) {
      const btn = await page.$('button.load-more, .load-more-btn, [class*="loadMore"], button[class*="load"], .see-more');
      if (!btn) break;
      try {
        await btn.click();
        await delay(2000);
        attempts++;
      } catch (e) { break; }
    }
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('.card, .promotion, .offer, article, [class*="promo"], [class*="offer"], [class*="card"]');
      const results = [];
      cards.forEach(card => {
        const title = card.querySelector('h1,h2,h3,h4,.title,.heading,.name')?.innerText?.trim();
        const desc  = card.querySelector('p,.desc,.description,.body')?.innerText?.trim();
        const disc  = card.querySelector('.discount,.saving,.badge,.highlight')?.innerText?.trim();
        const expiry = card.querySelector('.date,.expiry,.valid,.till')?.innerText?.trim();
        const link  = card.querySelector('a')?.href;
        if (title && title.length > 5) results.push({ title, desc: desc || '', disc: disc || '', expiry: expiry || '', link: link || '' });
      });
      return results;
    });
    for (const item of items) {
      const cat = guessCat(item.title + ' ' + item.desc);
      offers.push({
        bank: 'HNB', cat,
        title: item.title, desc: item.desc,
        disc: item.disc || 'Special offer',
        expiry: parseExpiry(item.expiry),
        url: item.link || url
      });
    }
  } catch (e) { console.warn(`  ✗ HNB error: ${e.message}`); }
  await closePage(page);
  console.log(`  ✓ HNB: ${offers.length} offers`);
  return offers;
}

// ─── DFCC ──────────────────────────────────────────────────────────────────
async function scrapeDFCC(browser) {
  console.log('📦 Scraping DFCC...');
  const offers = [];
  const baseUrl = 'https://www.dfcc.lk/cards/credit-card-offers';
  const page = await getPage(browser, baseUrl, 3000);
  let categoryUrls = [];
  try {
    categoryUrls = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="credit-card-offer"], a[href*="card-offer"], .category-link a, .offer-category a, nav a, .tab a');
      return [...new Set([...links].map(a => a.href).filter(h => h.includes('dfcc.lk') && h !== window.location.href))];
    });
  } catch (e) {}
  await closePage(page);

  if (categoryUrls.length === 0) categoryUrls = [baseUrl];

  for (const url of categoryUrls.slice(0, 10)) {
    console.log(`  → ${url}`);
    const p = await getPage(browser, url, 3000);
    try {
      const items = await p.evaluate(() => {
        const cards = document.querySelectorAll('.offer-card, .promo-card, article, [class*="offer"], [class*="promo"]');
        const results = [];
        cards.forEach(card => {
          const title = card.querySelector('h2,h3,h4,.title')?.innerText?.trim();
          const desc  = card.querySelector('p,.desc,.description')?.innerText?.trim();
          const disc  = card.querySelector('.discount,.saving,.badge,.off')?.innerText?.trim();
          const expiry = card.querySelector('.date,.expiry,.valid')?.innerText?.trim();
          const link  = card.querySelector('a')?.href;
          if (title && title.length > 5) results.push({ title, desc: desc || '', disc: disc || '', expiry: expiry || '', link: link || '' });
        });
        return results;
      });
      for (const item of items) {
        const cat = guessCat(item.title + ' ' + item.desc);
        offers.push({
          bank: 'DFCC', cat,
          title: item.title, desc: item.desc,
          disc: item.disc || 'Special offer',
          expiry: parseExpiry(item.expiry),
          url: item.link || url
        });
      }
    } catch (e) { console.warn(`  ✗ ${url}: ${e.message}`); }
    await closePage(p);
    await delay(1000);
  }
  console.log(`  ✓ DFCC: ${offers.length} offers`);
  return offers;
}

// ─── NTB ───────────────────────────────────────────────────────────────────
async function scrapeNTB(browser) {
  console.log('📦 Scraping NTB...');
  const offers = [];
  const categories = [
    { url: 'https://www.nationstrust.com/promotions/dining',        cat: 'Dining' },
    { url: 'https://www.nationstrust.com/promotions/hotels-resorts',cat: 'Travel' },
    { url: 'https://www.nationstrust.com/promotions/online',        cat: 'Online' },
    { url: 'https://www.nationstrust.com/promotions/wellness',      cat: 'Health' },
    { url: 'https://www.nationstrust.com/promotions/shopping',      cat: 'Shopping' },
    { url: 'https://www.nationstrust.com/promotions/other',         cat: 'Other' },
    { url: 'https://www.nationstrust.com/promotions/supermarkets',  cat: 'Supermarket' },
    { url: 'https://www.nationstrust.com/promotions/travel',        cat: 'Travel' },
  ];

  for (const { url, cat } of categories) {
    console.log(`  → ${url.split('/').pop()}`);
    const page = await getPage(browser, url, 3000);
    try {
      const items = await page.evaluate(() => {
        const cards = document.querySelectorAll('.promotion-card, .promo-item, .offer-card, article, [class*="promo"], [class*="card"]');
        const results = [];
        cards.forEach(card => {
          const title = card.querySelector('h2,h3,h4,.title,.heading')?.innerText?.trim();
          const desc  = card.querySelector('p,.desc,.description,.content')?.innerText?.trim();
          const disc  = card.querySelector('.discount,.saving,.badge,.tag')?.innerText?.trim();
          const expiry = card.querySelector('.date,.expiry,.valid,.validity,.till')?.innerText?.trim();
          const link  = card.querySelector('a')?.href;
          if (title && title.length > 5) results.push({ title, desc: desc || '', disc: disc || '', expiry: expiry || '', link: link || '' });
        });
        return results;
      });
      for (const item of items) {
        offers.push({
          bank: 'NTB', cat,
          title: item.title, desc: item.desc,
          disc: item.disc || 'Special offer',
          expiry: parseExpiry(item.expiry),
          url: item.link || url
        });
      }
    } catch (e) { console.warn(`  ✗ ${url}: ${e.message}`); }
    await closePage(page);
    await delay(1000);
  }
  console.log(`  ✓ NTB: ${offers.length} offers`);
  return offers;
}

// ─── BOC ───────────────────────────────────────────────────────────────────
async function scrapeBOC(browser) {
  console.log('📦 Scraping BOC...');
  const offers = [];
  const categories = [
    { url: 'https://www.boc.lk/personal-banking/card-offers/supermarkets',     cat: 'Supermarket' },
    { url: 'https://www.boc.lk/personal-banking/card-offers/dining',           cat: 'Dining' },
    { url: 'https://www.boc.lk/personal-banking/card-offers/travel-and-leisure',cat: 'Travel' },
    { url: 'https://www.boc.lk/personal-banking/card-offers/fashion',          cat: 'Shopping' },
    { url: 'https://www.boc.lk/personal-banking/card-offers/zero-plans',       cat: 'Instalment' },
    { url: 'https://www.boc.lk/personal-banking/card-offers/wellness',         cat: 'Health' },
    { url: 'https://www.boc.lk/personal-banking/card-offers/automobile',       cat: 'Other' },
  ];

  for (const { url, cat } of categories) {
    console.log(`  → ${url.split('/').pop()}`);
    const page = await getPage(browser, url, 3000);
    try {
      // Get sub-links from category page first
      const subLinks = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/product"], .offer-link a, .card a, article a');
        return [...new Set([...links].map(a => a.href).filter(h => h.includes('boc.lk')))];
      });

      if (subLinks.length > 0) {
        await closePage(page);
        for (const subUrl of subLinks.slice(0, 20)) {
          const sp = await getPage(browser, subUrl, 2000);
          try {
            const item = await sp.evaluate(() => {
              const title = document.querySelector('h1,h2,.offer-title,.page-title,.heading')?.innerText?.trim();
              const desc  = document.querySelector('.offer-description,.content p,.description,.body p')?.innerText?.trim();
              const disc  = document.querySelector('.discount,.saving,.badge,.highlight,.off')?.innerText?.trim();
              const expiry = document.querySelector('.expiry,.validity,.valid-till,.date')?.innerText?.trim();
              return { title, desc: desc || '', disc: disc || '', expiry: expiry || '' };
            });
            if (item.title && item.title.length > 5) {
              offers.push({
                bank: 'BOC', cat,
                title: item.title, desc: item.desc,
                disc: item.disc || 'Special offer',
                expiry: parseExpiry(item.expiry),
                url: subUrl
              });
            }
          } catch (e) {}
          await closePage(sp);
          await delay(500);
        }
      } else {
        // Parse cards directly on category page
        const items = await page.evaluate(() => {
          const cards = document.querySelectorAll('.offer-card,.card,article,[class*="offer"],[class*="promo"]');
          return [...cards].map(c => ({
            title: c.querySelector('h2,h3,h4,.title')?.innerText?.trim() || '',
            desc:  c.querySelector('p,.desc')?.innerText?.trim() || '',
            disc:  c.querySelector('.discount,.badge,.off')?.innerText?.trim() || '',
            expiry:c.querySelector('.expiry,.date,.valid')?.innerText?.trim() || '',
            link:  c.querySelector('a')?.href || ''
          })).filter(i => i.title.length > 5);
        });
        for (const item of items) {
          offers.push({ bank: 'BOC', cat, title: item.title, desc: item.desc, disc: item.disc || 'Special offer', expiry: parseExpiry(item.expiry), url: item.link || url });
        }
        await closePage(page);
      }
    } catch (e) {
      console.warn(`  ✗ ${url}: ${e.message}`);
      await closePage(page);
    }
    await delay(1000);
  }
  console.log(`  ✓ BOC: ${offers.length} offers`);
  return offers;
}

// ─── People's Bank ─────────────────────────────────────────────────────────
async function scrapePeoplesBank(browser) {
  console.log("📦 Scraping People's Bank...");
  const offers = [];
  const baseUrl = 'https://www.peoplesbank.lk/special-offers/';
  const page = await getPage(browser, baseUrl, 3000);
  let categoryUrls = [];
  try {
    categoryUrls = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="special-offer"], a[href*="offers"], .category a, .offer-cat a, .tab a, nav a');
      return [...new Set([...links].map(a => a.href).filter(h => h.includes('peoplesbank.lk') && h !== window.location.href))].slice(0, 15);
    });
  } catch (e) {}

  const urlsToScrape = categoryUrls.length > 0 ? categoryUrls : [baseUrl];
  await closePage(page);

  for (const url of urlsToScrape) {
    console.log(`  → ${url}`);
    const p = await getPage(browser, url, 3000);
    try {
      const items = await p.evaluate(() => {
        const cards = document.querySelectorAll('.offer-card,.promo-card,article,[class*="offer"],[class*="promo"]');
        return [...cards].map(c => ({
          title: c.querySelector('h2,h3,h4,.title,.heading')?.innerText?.trim() || '',
          desc:  c.querySelector('p,.desc,.description')?.innerText?.trim() || '',
          disc:  c.querySelector('.discount,.saving,.badge,.off')?.innerText?.trim() || '',
          expiry:c.querySelector('.date,.expiry,.valid')?.innerText?.trim() || '',
          link:  c.querySelector('a')?.href || ''
        })).filter(i => i.title.length > 5);
      });
      for (const item of items) {
        const cat = guessCat(item.title + ' ' + item.desc);
        offers.push({ bank: "People's", cat, title: item.title, desc: item.desc, disc: item.disc || 'Special offer', expiry: parseExpiry(item.expiry), url: item.link || url });
      }
    } catch (e) { console.warn(`  ✗ ${url}: ${e.message}`); }
    await closePage(p);
    await delay(1000);
  }
  console.log(`  ✓ People's: ${offers.length} offers`);
  return offers;
}

// ─── Sampath Bank ──────────────────────────────────────────────────────────
async function scrapeSampath(browser) {
  console.log('📦 Scraping Sampath...');
  const offers = [];
  const url = 'https://www.sampath.lk/sampath-cards/credit-card-offer';
  const page = await getPage(browser, url, 4000);
  try {
    // Get category tabs/links
    const catLinks = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.tab, .category, [class*="tab"], [class*="cat"], nav a, .filter a');
      return [...new Set([...tabs].map(t => t.href || t.dataset.target || '').filter(Boolean))];
    });

    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('.offer-card,.promo-card,.slide,.swiper-slide,article,[class*="offer"],[class*="promo"],[class*="card"]');
      return [...cards].map(c => ({
        title: c.querySelector('h2,h3,h4,.title,.heading,.name')?.innerText?.trim() || '',
        desc:  c.querySelector('p,.desc,.description,.text')?.innerText?.trim() || '',
        disc:  c.querySelector('.discount,.saving,.badge,.off,.highlight')?.innerText?.trim() || '',
        expiry:c.querySelector('.date,.expiry,.valid,.till')?.innerText?.trim() || '',
        link:  c.querySelector('a')?.href || ''
      })).filter(i => i.title.length > 5);
    });

    for (const item of items) {
      const cat = guessCat(item.title + ' ' + item.desc);
      offers.push({ bank: 'Sampath', cat, title: item.title, desc: item.desc, disc: item.disc || 'Special offer', expiry: parseExpiry(item.expiry), url: item.link || url });
    }
  } catch (e) { console.warn(`  ✗ Sampath error: ${e.message}`); }
  await closePage(page);
  console.log(`  ✓ Sampath: ${offers.length} offers`);
  return offers;
}

// ─── Other banks (generic scraper) ────────────────────────────────────────
async function scrapeGeneric(browser, bankName, url) {
  console.log(`📦 Scraping ${bankName}...`);
  const offers = [];
  const page = await getPage(browser, url, 4000);
  try {
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('.offer-card,.promo-card,.promotion,article,[class*="offer"],[class*="promo"],[class*="card"],[class*="deal"]');
      return [...cards].map(c => ({
        title: c.querySelector('h1,h2,h3,h4,.title,.heading,.name')?.innerText?.trim() || '',
        desc:  c.querySelector('p,.desc,.description,.content,.text,.body')?.innerText?.trim() || '',
        disc:  c.querySelector('.discount,.saving,.badge,.tag,.off,.highlight,.percent')?.innerText?.trim() || '',
        expiry:c.querySelector('.date,.expiry,.valid,.till,.validity,.until')?.innerText?.trim() || '',
        link:  c.querySelector('a')?.href || ''
      })).filter(i => i.title.length > 5);
    });
    for (const item of items) {
      const cat = guessCat(item.title + ' ' + item.desc);
      offers.push({ bank: bankName, cat, title: item.title, desc: item.desc, disc: item.disc || 'Special offer', expiry: parseExpiry(item.expiry), url: item.link || url });
    }
  } catch (e) { console.warn(`  ✗ ${bankName} error: ${e.message}`); }
  await closePage(page);
  console.log(`  ✓ ${bankName}: ${offers.length} offers`);
  return offers;
}

// ─── Utilities ─────────────────────────────────────────────────────────────
function guessCat(text) {
  const t = text.toLowerCase();
  if (/restaurant|dining|food|eat|buffet|lunch|dinner|café|cafe|bar|pub|pizza|burger|kfc/.test(t)) return 'Dining';
  if (/hotel|resort|villa|stay|room|travel|flight|airline|tour|holiday|vacation|booking|agoda/.test(t)) return 'Travel';
  if (/supermarket|grocery|keells|cargills|glomark|arpico|spar|fresh|veg|fruit|seafood/.test(t)) return 'Supermarket';
  if (/fashion|cloth|apparel|retail|shop|mall|store|jewel|watch|gold/.test(t)) return 'Shopping';
  if (/health|hospital|medical|clinic|pharma|wellness|spa|beauty|vision|dental|hearing/.test(t)) return 'Health';
  if (/fuel|petrol|diesel|gas|ioc|ceypetco|lanka/.test(t)) return 'Fuel';
  if (/instalment|ipp|0%|zero|epp|emi|payment plan|interest free/.test(t)) return 'Instalment';
  if (/online|e-commerce|digital|web|app|delivery/.test(t)) return 'Online';
  if (/reward|point|miles|loyalty|cashback|redeem/.test(t)) return 'Rewards';
  return 'Other';
}

function parseExpiry(text) {
  if (!text) return getDefaultExpiry();
  // Try to find a date pattern
  const patterns = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,  // DD/MM/YYYY
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,  // YYYY-MM-DD
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})[,\s]+(\d{4})/i,
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
  ];
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      try {
        let d, mo, y;
        if (pat.source.includes('Jan|Feb')) {
          if (m[3] && m[3].length === 4) { d = parseInt(m[1]); mo = months[m[2].toLowerCase().slice(0,3)]; y = parseInt(m[3]); }
          else if (m[1].match(/Jan|Feb/i)) { mo = months[m[1].toLowerCase().slice(0,3)]; d = parseInt(m[2]); y = parseInt(m[3]); }
          else { mo = months[m[1].toLowerCase().slice(0,3)]; y = parseInt(m[2]); d = 28; }
        } else if (m[1].length === 4) { y=parseInt(m[1]); mo=parseInt(m[2]); d=parseInt(m[3]); }
        else { d=parseInt(m[1]); mo=parseInt(m[2]); y=parseInt(m[3]); }
        if (y && mo && d) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      } catch (e) {}
    }
  }
  return getDefaultExpiry();
}

function getDefaultExpiry() {
  const d = new Date();
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().slice(0, 10);
}

function deduplicateOffers(offers) {
  const seen = new Set();
  return offers.filter(o => {
    const key = `${o.bank}|${o.title.toLowerCase().slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Sri Lanka Credit Card Offers Scraper');
  console.log('=========================================');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  let allOffers = [];

  try {
    const scrapers = [
      () => scrapeNDB(browser),
      () => scrapeSeylan(browser),
      () => scrapeComBank(browser),
      () => scrapeHNB(browser),
      () => scrapeDFCC(browser),
      () => scrapeNTB(browser),
      () => scrapeBOC(browser),
      () => scrapePeoplesBank(browser),
      () => scrapeSampath(browser),
      () => scrapeGeneric(browser, 'Pan Asia', 'https://www.pabcbank.com/card-offers/'),
      () => scrapeGeneric(browser, 'Cargills', 'https://www.cargillsbank.com/promotions'),
      () => scrapeGeneric(browser, 'CDB', 'https://www.cdb.lk/cdb-offers'),
      () => scrapeGeneric(browser, 'Standard Chartered', 'https://www.sc.com/lk/promotions/'),
    ];

    for (const scraper of scrapers) {
      try {
        const results = await scraper();
        allOffers.push(...results);
      } catch (e) {
        console.error(`  ✗ Scraper failed: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  allOffers = deduplicateOffers(allOffers);

  // Assign sequential IDs
  allOffers = allOffers.map((o, i) => ({ id: i + 1, ...o }));

  console.log(`\n✅ Total unique offers scraped: ${allOffers.length}`);

  // Write JSON for use by build script
  fs.writeFileSync(
    path.join(__dirname, 'offers.json'),
    JSON.stringify(allOffers, null, 2)
  );
  console.log('💾 Saved to offers.json');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
