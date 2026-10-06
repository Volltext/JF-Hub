'use strict';
// Demo-Link aus der Build-Variable DEMO_URL (siehe build.sh). Ohne Demo bleiben die Ersatz-Links sichtbar – auch ohne JavaScript.
(function () {
  var url = document.documentElement.getAttribute('data-demo-url') || '';
  var hasDemo = /^https?:\/\/[^\s"'<>]+$/.test(url);
  document.querySelectorAll('[data-demo]').forEach(function (el) {
    if (!hasDemo) return;
    if (el.tagName === 'A') el.href = url;
    el.hidden = false;
  });
  document.querySelectorAll('[data-no-demo]').forEach(function (el) {
    el.hidden = hasDemo;
  });

  // „Link teilen“: Teilen-Menü des Handys, sonst in die Zwischenablage.
  var share = document.querySelector('[data-share]');
  if (!share) return;
  var label = share.textContent;
  share.addEventListener('click', function () {
    var data = { title: 'JF Hub', text: 'JF Hub – kostenlose App für Betreuer in der Jugendfeuerwehr', url: location.href.split('#')[0] };
    if (navigator.share) {
      navigator.share(data).catch(function () {});
      return;
    }
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(data.url).then(function () {
      share.textContent = 'Link kopiert ✓';
      setTimeout(function () { share.textContent = label; }, 2500);
    });
  });
})();
