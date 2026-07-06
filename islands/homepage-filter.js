/* Homepage "Find Your Home" -> /new-homes/ (the Communities page) with the chosen
 * filters as URL params. Live POSTs oi-filter-form to a server-generated
 * /new-homes/filter/<hash>/ page whose results are COMMUNITIES; the static mirror
 * can't mint filter hashes, so we land on the Communities island which pre-applies
 * the params client-side (communities-live.js) — same result content type as live.
 * Intercepts the oilib Search button (capture phase + stopImmediatePropagation) so
 * oilib's own handler doesn't also fire. Values carry the oilib prefix grammar
 * (=exact %min-max @>=N ~type); we strip it and the island re-applies by bare value. */
(function () {
  function init() {
    var form = document.getElementById('oi-filter-form');
    if (!form || form.getAttribute('data-filter-type') !== 'homepage') return;
    var btn = form.querySelector('.oi-filter-click');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var p = new URLSearchParams();
      form.querySelectorAll('select[name], input[name]').forEach(function (el) {
        if (el.name === 'b' || el.name === 'url') return;
        if (el.type === 'checkbox' && !el.checked) return;
        var v = el.value;
        if (v) p.append(el.name, String(v).replace(/^[=%@~]/, ''));
      });
      var qs = p.toString();
      window.location.href = '/new-homes/' + (qs ? '?' + qs : '');
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
