/* Homepage "Find Your Home" -> /new-homes/available/ with the chosen filters as URL
 * params, replicating O'Neill's city passthrough. Intercepts the oilib Search button
 * (capture phase + stopImmediatePropagation) so oilib's own handler doesn't also fire.
 * Values carry the oilib prefix grammar (=exact %min-max @>=N ~type); we strip it and
 * the available-page island re-applies by bare value. */
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
      window.location.href = '/new-homes/available/' + (qs ? '?' + qs : '');
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
