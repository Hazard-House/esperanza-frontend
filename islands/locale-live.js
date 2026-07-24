/* locale-live.js — Spanish i18n disabled; pin English and clear legacy es cookie. */
(function () {
  'use strict';
  document.documentElement.lang = 'en';
  document.cookie = 'esperanza_lang=en;path=/;max-age=31536000;SameSite=Lax';
  var sw = document.getElementById('locale-switcher');
  if (sw) sw.remove();
})();
