// promo-utils.mjs — parse QMI incentive banners and shared payment/savings math,
// plus the "is this promo copy still live?" gate used to evict deleted incentives.

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

/** Compare promo copy case/punctuation-insensitively — the June-8 harvest and the API
 *  disagree on casing, trailing asterisks AND thousands separators for the SAME
 *  promotion ("$5,000" vs "$5000" both occur in public/, see demo()). Digit-group
 *  commas are dropped BEFORE punctuation is squashed to spaces, or "5,000" would
 *  normalise to "5 000" and read as a different offer — which would evict a promo
 *  the API still vouches for. */
export function normPromoText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every piece of promo copy the LIVE API still vouches for: per-entity promo text
 *  (qmi.promo_text / community.promoBannerText / floorplan.promoBannerText) plus the
 *  title/banner/badge of every ACTIVE promotion. Anything baked into public/ that is
 *  not in here belongs to a promotion that was deleted or deactivated in D1. */
export function livePromoTexts({ qmis = [], communities = [], floorplans = [], promotions = [] } = {}) {
  const set = new Set();
  const add = t => { const n = normPromoText(t); if (n) set.add(n); };
  for (const h of qmis) add(h.promo);
  for (const c of communities) add(c.promo);
  for (const fp of floorplans) add(fp.promo);
  for (const p of promotions) {
    if (!p || p.active === false) continue;
    add(p.title); add(p.bannerText); add(p.cardBadgeText);
  }
  return set;
}

/** Fail OPEN: an empty/absent corpus (API hiccup, caller never set one) means "can't
 *  tell" and every string is treated as live. A bad fetch must never strip the promo
 *  copy off every card in public/. */
export function isLivePromoText(text, live) {
  const n = normPromoText(text);
  if (!n) return true;
  if (!(live instanceof Set) || live.size === 0) return true;
  return live.has(n);
}

/** Percent rate from promo text (e.g. "4.99% Rate + …" → 4.99). */
export function parsePromoRate(text) {
  const m = String(text || '').match(/([\d.]+)\s*%/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** True when the banner carries a mortgage rate below the standard rate. */
export function isRatePromo(promoText, standardRate) {
  const promoRate = parsePromoRate(promoText);
  const std = Number(standardRate);
  return promoRate != null && Number.isFinite(std) && promoRate > 0 && promoRate < std;
}

/** Full monthly payment (P&I + tax + ins + PMI + HOA) — matches sections.mjs / OiCalc. */
export function totalMonthly(price, ratePct, taxMult, opts = {}) {
  const downPct = opts.downPct ?? 3.5;
  const termYrs = opts.termYrs ?? 30;
  const hoaAnnual = opts.hoaAnnual ?? 0;
  const pmiOn = opts.pmiOn !== false;
  const loan = price * (1 - downPct / 100);
  const months = termYrs * 12;
  const r = ratePct / 1200;
  const pi = r ? loan * r / (1 - Math.pow(1 + r, -months)) : loan / months;
  const taxM = price * (taxMult / 100) / 12;
  const ins = price * 0.004 / 12;
  const pmi = pmiOn && downPct < 20 ? loan * 0.0075 / 12 : 0;
  const hoa = hoaAnnual / 12;
  return Math.round((pi + taxM + ins + pmi + hoa) * 100) / 100;
}

/** 30-year savings label text (full payment delta × months). */
export function savingsOverTerm(stdMonthly, promoMonthly, termYrs = 30) {
  const save = (stdMonthly - promoMonthly) * termYrs * 12;
  if (!(save > 0)) return '';
  return '$' + save.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + ' Savings Over ' + termYrs + ' Years';
}

/** Inline browser script wired after OiCalc init on rate-promo QMI pages. */
export function promoCalcScript(promoRate) {
  const rate = Number(promoRate);
  return `(function(){`
    + `function readNum(sel,def){var el=document.querySelector(sel);var v=el?Number(el.value):NaN;return Number.isFinite(v)?v:def;}`
    + `function readEmi(){var d=document.querySelector('.emi-wrap .dollars'),c=document.querySelector('.emi-wrap .cents');`
    + `if(!d||!c)return NaN;var dollars=Number(String(d.textContent||'').replace(/,/g,'')),`
    + `cents=Number('.'+String(c.textContent||'0'));return dollars+cents;}`
    + `function readTaxMonthly(price){var t=readNum('.oi-calc-taxamount',NaN);`
    + `if(Number.isFinite(t)&&t>0)return Math.round(t/12*100)/100;`
    + `var tm=readNum('.oi-calc-taxmultiplier',0);tm=tm>1?tm:tm*100;return Math.round(price*tm/100/12*100)/100;}`
    + `function readHoaMonthly(){return Math.round(readNum('.oi-calc-hoa',0)/12*100)/100;}`
    + `function readHomeInsMonthly(price){var hi=readNum('.oi-calc-homeins',NaN);`
    + `if(Number.isFinite(hi)&&hi>0)return Math.round(hi/12*100)/100;return Math.round(price*0.004/12*100)/100;}`
    + `function readPmiMonthly(price,dp){var pmiEl=document.querySelector('.oi-calc-pmiamount');`
    + `if(pmiEl&&!pmiEl.checked)return 0;var loan=price-dp;if(loan<=0)return 0;return Math.round(loan*0.0075/12*100)/100;}`
    + `function fmt(n){return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}`
    + `function promoCalc(){`
    + `var promoRateEl=document.querySelector('.promo-rate'),`
    + `promoMonthlyEl=document.getElementById('promo-monthly'),`
    + `promoSavingEl=document.getElementById('promo-saving'),`
    + `externalPromoSavingEl=document.getElementById('calculator-promo-saving'),`
    + `termSelectedEl=document.getElementById('term-selected');`
    + `if(!promoMonthlyEl||!promoRateEl)return;`
    + `var price=readNum('.oi-calc-price',0),`
    + `rate=Number(promoRateEl.value)||${rate},`
    + `dpRate=readNum('.oi-calc-downpaymentpercent',3.5),`
    + `dp=Math.round(price*(dpRate/100)),`
    + `termYrs=readNum('.oi-calc-term',30),`
    + `term=termYrs*12,`
    + `emi=readEmi();`
    + `if(!price||!Number.isFinite(emi))return;`
    + `var taxes=readTaxMonthly(price),homeIns=readHomeInsMonthly(price),`
    + `hoa=readHoaMonthly(),pmi=readPmiMonthly(price,dp),`
    + `principal=price-dp,r=rate/100/12,`
    + `monthly=r?principal*r/(1-Math.pow(1+r,-term)):principal/term;`
    + `monthly=Math.round(monthly*100)/100;`
    + `var monthlyTotal=Math.round((monthly+taxes+homeIns+hoa+pmi)*100)/100,`
    + `monthlySaving=Math.round((emi-monthlyTotal)*100)/100,`
    + `totalSaving=Math.round(monthlySaving*term*100)/100;`
    + `if(!(totalSaving>0)){promoMonthlyEl.textContent='';`
    + `if(promoSavingEl)promoSavingEl.textContent='';`
    + `if(externalPromoSavingEl){externalPromoSavingEl.textContent='';externalPromoSavingEl.style.display='none';}`
    + `if(termSelectedEl)termSelectedEl.textContent=termYrs;return;}`
    + `promoMonthlyEl.textContent=fmt(monthlyTotal);`
    + `if(promoSavingEl)promoSavingEl.textContent=fmt(totalSaving);`
    + `if(externalPromoSavingEl){externalPromoSavingEl.textContent=fmt(totalSaving)+' Savings Over '+termYrs+' Years';externalPromoSavingEl.style.display='';}`
    + `if(termSelectedEl)termSelectedEl.textContent=termYrs;`
    + `}`
    + `window.esperanzaPromoCalc=promoCalc;`
    + `function schedule(){requestAnimationFrame(promoCalc);}`
    + `promoCalc();`
    + `document.querySelectorAll('.oi-calc input,.oi-calc select').forEach(function(el){`
    + `el.addEventListener('input',schedule);el.addEventListener('change',schedule);});`
    + `})();`;
}

// ponytail self-check: the live-copy gate decides whether baked promo copy survives a
// rebuild, so assert both directions AND the fail-open guard.
function demo() {
  assert(normPromoText('4.99% 30 YEAR FIXED RATE*') === normPromoText('4.99% 30 Year Fixed Rate'),
    'normPromoText: case/punctuation-insensitive');
  assert(normPromoText('4.99% 30-Year Fixed Rate*') === normPromoText('4.99% 30 Year Fixed Rate'),
    'normPromoText: hyphenation-insensitive');
  // Both spellings are live in public/ for the SAME promotion — they must compare equal
  // or the sweep would strip a promo the API still vouches for.
  assert(normPromoText('4.99% Rate + up to $5,000 in Closing Costs') === normPromoText('4.99% Rate + up to $5000 in Closing Costs'),
    'normPromoText: thousands separator-insensitive');
  assert(normPromoText('$3,000 off') !== normPromoText('$5,000 off'), 'normPromoText: different amounts stay different');
  assert(normPromoText('Save 1,2,3') === 'save 1 2 3', 'normPromoText: only 3-digit groups are joined');
  const live = livePromoTexts({
    qmis: [{ promo: 'Unlock Your $15K Flex Discount Now!' }, { promo: '' }],
    communities: [{ promo: 'Eligible for Homebuyer Advantage Program' }],
    floorplans: [{ promo: null }],
    promotions: [
      { active: true, title: '4.99% ARM*', bannerText: '', cardBadgeText: '' },
      { active: false, title: '4.99% 30 YEAR FIXED RATE*', bannerText: '', cardBadgeText: '' },
    ],
  });
  assert(live.has(normPromoText('unlock your $15k flex discount now!')), 'per-home promo text in corpus');
  assert(live.has(normPromoText('4.99% arm*')), 'active promotion title in corpus');
  assert(live.has(normPromoText('Eligible for Homebuyer Advantage Program')), 'community promo in corpus');
  assert(!live.has(normPromoText('4.99% 30 YEAR FIXED RATE*')), 'deactivated promotion NOT in corpus');
  assert(isLivePromoText('4.99% ARM*', live), 'live copy kept');
  assert(isLivePromoText('4.99% 30 Year Fixed Rate*', live) === false, 'dead copy rejected (any casing)');
  assert(isLivePromoText('', live), 'empty text is a no-op, not "dead"');
  assert(isLivePromoText('4.99% 30 YEAR FIXED RATE*', new Set()), 'fail open on empty corpus');
  assert(isLivePromoText('4.99% 30 YEAR FIXED RATE*', null), 'fail open on missing corpus');
  assert(parsePromoRate('4.99% Rate + up to $5,000') === 4.99, 'parsePromoRate');
  assert(isRatePromo('4.99% ARM*', 6.35) && !isRatePromo('Flex Cash', 6.35), 'isRatePromo');
  assert(savingsOverTerm(2000, 1800, 30).startsWith('$72,000.00 Savings Over 30 Years'), 'savingsOverTerm');
  console.log('promo-utils.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
