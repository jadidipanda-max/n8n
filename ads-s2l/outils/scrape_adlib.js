const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.ADLIB_OUT || './data';

const EXTRACT = () => {
  const marker = 'ID dans la bibliothèque';
  const nodes = Array.from(document.querySelectorAll('div,span'))
    .filter(el => (el.textContent || '').includes(marker))
    .filter(el => !Array.from(el.children).some(c => (c.textContent || '').includes(marker)));
  const cards = [];
  for (const n of nodes) {
    let el = n, best = n;
    for (let i = 0; i < 14 && el.parentElement; i++) {
      el = el.parentElement;
      const t = el.textContent || '';
      if ((t.split(marker).length - 1) > 1) break;
      best = el;
    }
    const txt = best.innerText || '';
    const idm = txt.match(/ID dans la bibliothèque\s*:?\s*(\d+)/);
    if (!idm) continue;
    cards.push({
      libId: idm[1],
      text: txt,
      hasVideoEl: !!best.querySelector('video'),
      imgCount: best.querySelectorAll('img').length,
      media: Array.from(best.querySelectorAll('img')).map(i => i.src).filter(s => s && s.includes('scontent')).slice(0, 2),
    });
  }
  return cards;
};

(async () => {
  const label = process.argv[2];
  const url = process.argv[3];
  const target = parseInt(process.argv[4] || '60', 10);
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    locale: 'fr-FR', timezoneId: 'Europe/Paris',
    viewport: { width: 1500, height: 1100 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(7000);
  for (const l of ['Autoriser tous les cookies', 'Refuser les cookies optionnels', 'Tout accepter']) {
    const b = page.getByRole('button', { name: l });
    if (await b.count().catch(() => 0)) { await b.first().click({ timeout: 4000 }).catch(() => {}); break; }
  }
  await page.waitForTimeout(5000);

  const head = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/([\d\s ]+)\s*r[ée]sultats?/);
    return m ? m[1].replace(/[\s ]/g, '') : null;
  });

  // Accumulate across scrolls: offscreen cards get unmounted, so never re-derive from scratch.
  const acc = new Map();
  let stale = 0;
  for (let i = 0; i < 60 && acc.size < target && stale < 6; i++) {
    const before = acc.size;
    for (const c of await page.evaluate(EXTRACT)) if (!acc.has(c.libId)) acc.set(c.libId, c);
    stale = acc.size > before ? 0 : stale + 1;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(2200);
  }
  const cards = Array.from(acc.values());
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/${label}.json`, JSON.stringify({ label, url, resultsCount: head, scraped: cards.length, cards }, null, 2));
  console.log(`${label}: annonce=${head} recupere=${cards.length}`);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
