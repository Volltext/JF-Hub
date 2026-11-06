'use strict';
(function () {
  // Die Demo-Knöpfe zeigen auf die Demo im Browser (demo/). Gibt es eine Server-Demo (DEMO_URL, siehe build.sh), dorthin.
  var url = document.documentElement.getAttribute('data-demo-url') || '';
  if (/^https?:\/\/[^\s"'<>]+$/.test(url)) {
    document.querySelectorAll('a[data-demo]').forEach(function (el) {
      el.href = url;
    });
  }

  // „Kopieren“ an Befehls-Blöcken: nur sichtbar, wenn der Browser in die Zwischenablage schreiben darf.
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    var pre = btn.parentNode.querySelector('pre');
    if (!pre || !navigator.clipboard) return;
    btn.hidden = false;
    var text = btn.textContent;
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(pre.textContent.trim()).then(function () {
        btn.textContent = 'Kopiert ✓';
        setTimeout(function () { btn.textContent = text; }, 2500);
      });
    });
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
