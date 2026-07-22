// promo-utils.mjs — parse QMI incentive banners and shared payment/savings math.

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
