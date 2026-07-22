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
    + `function fmtTotal(n){n=Number(n)||0;var p=n.toFixed(2).split('.');`
    + `return '<span class="dollar-sign">$</span><span class="dollars">'+p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')+'</span><span class="decimal">.</span><span class="cents">'+p[1]+'</span>';}`
    + `function readNum(sel,def){var el=document.querySelector(sel);var v=el?Number(el.value):NaN;return Number.isFinite(v)?v:def;}`
    + `function taxMult(){var t=readNum('.oi-calc-taxmultiplier',0);return t>1?t:t*100;}`
    + `function totalMonthly(price,ratePct){`
    + `var down=readNum('.oi-calc-downpaymentpercent',3.5),term=readNum('.oi-calc-term',30),`
    + `hoaM=readNum('.oi-calc-hoa',0),pmiEl=document.querySelector('.oi-calc-pmiamount'),`
    + `pmiOn=pmiEl?pmiEl.checked:true,loan=price*(1-down/100),months=term*12,r=ratePct/1200,`
    + `pi=r?loan*r/(1-Math.pow(1+r,-months)):loan/months,`
    + `tax=price*taxMult()/100/12,ins=price*0.004/12,`
    + `pmi=pmiOn&&down<20?loan*0.0075/12:0;`
    + `return Math.round((pi+tax+ins+pmi+hoaM)*100)/100;}`
    + `function promoCalc(){`
    + `var stdRate=readNum('.oi-calc-rate',6.2),price=readNum('.oi-calc-price',0),`
    + `term=readNum('.oi-calc-term',30),promoRate=${rate},`
    + `pm=document.getElementById('promo-monthly'),ps=document.getElementById('promo-saving');`
    + `if(!pm||!price||!(promoRate<stdRate))return;`
    + `var std=totalMonthly(price,stdRate),pro=totalMonthly(price,promoRate),`
    + `txt=fmtTotal(pro),save=(std-pro)*term*12;`
    + `pm.innerHTML=txt;`
    + `var line=save>0?"$"+save.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' Savings Over '+term+' Years':'';`
    + `if(ps)ps.textContent=line;`
    + `['calculator-promo-saving','calc-savings-line'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent=line;});`
    + `}`
    + `window.esperanzaPromoCalc=promoCalc;`
    + `promoCalc();`
    + `document.querySelectorAll('.oi-calc input,.oi-calc select').forEach(function(el){`
    + `el.addEventListener('input',promoCalc);el.addEventListener('change',promoCalc);});`
    + `})();`;
}
