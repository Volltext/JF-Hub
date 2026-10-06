'use strict';
/* Admin-GUI: bewusst ohne Framework und ohne innerHTML mit Fremddaten (CSP, XSS). */
(function () {
  var root = document.getElementById('app');
  var state = { status: null };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (function add(list) {
      list.forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return add(c);
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    })(Array.prototype.slice.call(arguments, 2));
    return el;
  }

  // ---------- Symbole (Lucide-Pfade, per DOM erzeugt) ----------
  var ICONS = {
    home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
    file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
    layout: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 9h18'],
    phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
    shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
    db: ['M3 5v14a9 3 0 0 0 18 0V5', 'M3 12a9 3 0 0 0 18 0', 'M21 5c0 1.66-4 3-9 3S3 6.66 3 5s4-3 9-3 9 1.34 9 3'],
    out: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    dl: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    exit: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  };
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  // ---------- Server-Zugriff ----------
  function api(method, path, body) {
    var headers = { 'X-JFH': '1' };
    var init = { method: method, headers: headers, credentials: 'same-origin' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch('/api' + path, init).then(function (r) {
      if (r.status === 401 && path !== '/login') {
        render();
        throw new Error('Nicht angemeldet');
      }
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Fehler ' + r.status); });
      }
      return r;
    });
  }
  function json(method, path, body) {
    return api(method, path, body).then(function (r) { return r.json(); });
  }
  function download(path, name, open) {
    return api('GET', path).then(function (r) { return r.blob(); }).then(function (b) {
      var url = URL.createObjectURL(b);
      if (open) window.open(url, '_blank');
      else {
        var a = h('a', { href: url, download: name });
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
  }

  // ---------- Hilfen ----------
  function msgBox() {
    var box = h('div');
    box.show = function (text, ok) {
      box.textContent = '';
      if (text) box.appendChild(h('div', { class: 'msg ' + (ok ? 'ok' : 'err'), role: 'status' }, text));
    };
    return box;
  }
  function run(btn, box, fn, okText) {
    btn.disabled = true;
    box.show('');
    return fn().then(function () { if (okText) box.show(okText, true); })
      .catch(function (e) { box.show(e.message, false); })
      .then(function () { btn.disabled = false; });
  }
  function field(label, input) { return h('label', null, label, input); }
  function fmt(ts) { return ts ? new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–'; }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  /** Eigene Bestätigung statt confirm(): gleiche Optik wie die App. */
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      var dlg = h('dialog', { 'aria-label': title });
      function done(v) { dlg.close(); dlg.remove(); resolve(v); }
      dlg.appendChild(h('h2', null, title));
      dlg.appendChild(h('p', null, text));
      dlg.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: function () { done(false); } }, 'Abbrechen'),
        h('button', { class: 'btn solid-danger', onclick: function () { done(true); } }, okLabel)));
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function pageHead(title, sub) {
    return h('div', { class: 'page__head' }, h('h1', null, title), sub && h('p', null, sub));
  }

  // ---------- Anmeldung / Setup ----------
  function authView(setup) {
    var box = msgBox();
    var code = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    var user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    var name = h('input', { type: 'text', autocomplete: 'name', maxlength: 60, placeholder: 'z. B. Anna Beispiel' });
    var pw = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', minlength: 10 });
    var btn = h('button', { class: 'btn primary', type: 'submit' }, setup ? 'Admin-Konto anlegen' : 'Anmelden');
    var form = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      run(btn, box, function () {
        var req = setup
          ? { code: code.value, username: user.value, displayName: name.value, password: pw.value, device: 'Admin-Browser' }
          : { username: user.value, password: pw.value, device: 'Admin-Browser' };
        return json('POST', setup ? '/setup' : '/login', req).then(render);
      });
    } },
      h('h2', null, setup ? 'Ersteinrichtung' : 'Anmeldung'),
      setup && h('p', { class: 'muted small' }, 'Den Setup-Code findest du im Log des Containers (in der Docker-Oberfläche unter „Logs“, sonst „docker compose logs jf-hub“). Dieses Konto wird der erste Admin.'),
      setup && field('Setup-Code', code),
      field('Benutzername', user),
      setup && field('Anzeigename', name),
      field(setup ? 'Passwort (mind. 10 Zeichen)' : 'Passwort', pw),
      btn, box);
    return h('div', { class: 'center' }, h('div', { class: 'brand', style: 'margin-bottom:16px' }, h('img', { class: 'logo', src: 'favicon.svg', alt: '' }), 'JF Hub – Server'), form);
  }

  // ---------- Bereiche ----------
  // [id, Beschriftung, Symbol, Beschreibung]
  var GROUPS = [
    ['', [['overview', 'Übersicht', 'home']]],
    ['Inhalte', [['protocols', 'Protokolle', 'file']]],
    ['Gruppe', [['users', 'Benutzer', 'users']]],
    ['Anpassen', [['layout', 'PDF-Layout', 'layout']]],
    ['Zugriff', [['devices', 'Geräte', 'phone'], ['security', 'Konto & Laufzeiten', 'shield']]],
    ['Daten', [['backup', 'Backup & Export', 'db']]],
  ];
  var VIEWS = {};

  function currentTab() {
    var t = location.hash.replace(/^#\/?/, '');
    return VIEWS[t] ? t : 'overview';
  }
  function go(tab) { location.hash = '#/' + tab; }

  function shell(content) {
    var tab = currentTab();
    var nav = h('nav', { class: 'nav', 'aria-label': 'Bereiche' }, GROUPS.map(function (g) {
      return h('div', { class: 'nav__group' },
        g[0] && h('div', { class: 'nav__label' }, g[0]),
        g[1].map(function (t) {
          return h('button', { 'aria-current': tab === t[0] ? 'page' : false, onclick: function () { go(t[0]); } }, icon(t[2]), t[1]);
        }));
    }));
    function logout() { json('POST', '/logout').then(render, render); }
    var side = h('aside', { class: 'side' },
      h('div', { class: 'side__top' },
        h('div', { class: 'brand' }, h('img', { class: 'logo', src: 'favicon.svg', alt: '' }), h('div', null, 'JF Hub', h('small', null, 'Server-Verwaltung'))),
        h('button', { class: 'btn small btn--out', onclick: logout }, 'Abmelden')),
      nav,
      h('div', { class: 'side__foot' },
        h('a', { class: 'side__link', href: '/' }, icon('out'), 'Zur Web-App'),
        h('button', { class: 'side__link', onclick: logout }, icon('exit'), 'Abmelden')));
    return h('div', { class: 'layout' }, side, h('main', { class: 'content' }, content));
  }

  VIEWS.overview = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    var stats = h('div', { class: 'card' }, h('h2', null, 'Status'), h('p', { class: 'muted' }, 'Lade …'));
    var tiles = h('div', { class: 'tiles' },
      tile('Benutzer verwalten', 'Betreuer einladen, sperren, Passwort zurücksetzen', 'users', 'users'),
      tile('Protokolle verwalten', 'Ansehen, als PDF öffnen, Papierkorb', 'file', 'protocols'),
      tile('PDF-Layout anpassen', 'Logo, Kopf- und Fußzeile, Akzentfarbe', 'layout', 'layout'),
      tile('Geräte & Passwort', 'Wer ist angemeldet, eigenes Passwort ändern', 'shield', 'security'),
      tile('Backup herunterladen', 'Datenbank und alle Protokolle sichern', 'db', 'backup'));
    Promise.all([json('GET', '/admin/info'), json('GET', '/admin/sessions')]).then(function (r) {
      var i = r[0];
      var up = Math.floor(i.uptime / 86400) ? Math.floor(i.uptime / 86400) + ' d ' : '';
      up += Math.floor((i.uptime % 86400) / 3600) + ' h ' + Math.floor((i.uptime % 3600) / 60) + ' min';
      stats.textContent = '';
      stats.appendChild(h('h2', null, 'Status'));
      stats.appendChild(h('div', { class: 'grid' },
        stat(i.users, 'Benutzer'), stat(i.protocols, 'Protokolle'), stat(i.trashed, 'im Papierkorb'), stat(r[1].length, 'angemeldete Geräte'),
        stat(i.version, 'Serverversion'), stat(up, 'Laufzeit')));
    }).catch(function (e) { stats.appendChild(h('div', { class: 'msg err' }, e.message)); });
    wrap.appendChild(pageHead('Übersicht', 'Die Web-App (PWA) für alle Betreuer erreichst du unter dem Hauptpfad dieser Adresse.'));
    wrap.appendChild(h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '/' }, 'Web-App öffnen')));
    wrap.appendChild(stats);
    wrap.appendChild(tiles);
    return wrap;
  };
  function stat(v, label) { return h('div', { class: 'stat' }, h('b', null, v), h('span', null, label)); }
  function tile(title, sub, ic, tab) {
    return h('button', { class: 'tile', onclick: function () { go(tab); } }, h('b', null, icon(ic), title), h('span', null, sub));
  }

  VIEWS.protocols = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    var card = h('div', { class: 'card' });
    var box = msgBox();
    var filter = 'active';
    var query = '';
    var rows = [];
    var list = h('div');
    var search = h('input', { type: 'search', placeholder: 'Titel, Datum, Ort oder Autor suchen', 'aria-label': 'Protokolle durchsuchen', oninput: function () { query = search.value.trim().toLowerCase(); draw(); } });
    var filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Anzeige' });

    function drawFilters(nActive, nTrash) {
      filters.textContent = '';
      [['active', 'Aktiv (' + nActive + ')'], ['trash', 'Papierkorb (' + nTrash + ')']].forEach(function (f) {
        filters.appendChild(h('button', { 'aria-pressed': String(filter === f[0]), onclick: function () { filter = f[0]; draw(); } }, f[1]));
      });
    }
    function draw() {
      var nTrash = rows.filter(function (r) { return r.deletedAt != null; }).length;
      drawFilters(rows.length - nTrash, nTrash);
      var shown = rows.filter(function (r) {
        if ((r.deletedAt != null) !== (filter === 'trash')) return false;
        return !query || [r.title, r.datum, r.ort, r.owner].join(' ').toLowerCase().indexOf(query) >= 0;
      });
      list.textContent = '';
      if (!shown.length) {
        list.appendChild(h('div', { class: 'empty' }, query ? 'Keine Treffer.' : filter === 'trash' ? 'Der Papierkorb ist leer.' : 'Noch keine Protokolle.'));
        return;
      }
      var body = h('tbody');
      shown.forEach(function (r) {
        var acts = h('td', { class: 'act' });
        var title = r.title || 'Ohne Titel';
        if (r.deletedAt == null) {
          acts.appendChild(h('button', { class: 'btn small', onclick: function () { download('/protocols/' + encodeURIComponent(r.id) + '/pdf', '', true).catch(function (e) { box.show(e.message); }); } }, 'PDF öffnen'));
        } else {
          acts.appendChild(h('button', { class: 'btn small', onclick: function () { json('POST', '/admin/protocols/' + encodeURIComponent(r.id) + '/restore').then(load, function (e) { box.show(e.message); }); } }, 'Wiederherstellen'));
          acts.appendChild(document.createTextNode(' '));
          acts.appendChild(h('button', { class: 'btn small danger', onclick: function () {
            confirmBox('Endgültig löschen?', '„' + title + '“ wird unwiderruflich entfernt.', 'Löschen').then(function (ok) {
              if (ok) json('DELETE', '/admin/protocols/' + encodeURIComponent(r.id)).then(load, function (e) { box.show(e.message); });
            });
          } }, 'Löschen'));
        }
        body.appendChild(h('tr', null,
          h('td', null, title),
          h('td', { class: 'muted' }, r.owner || '–', ' ', h('span', { class: 'tag' }, r.shared ? 'veröffentlicht' : 'privat')),
          h('td', { class: 'muted' }, r.datum || '–'),
          h('td', { class: 'muted' }, r.ort || '–'),
          h('td', { class: 'muted' }, fmt(r.updatedAt) + (r.size ? ' · ' + fmtSize(r.size) : '')),
          acts));
      });
      list.appendChild(h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Titel'), h('th', null, 'Von'), h('th', null, 'Datum'), h('th', null, 'Ort'), h('th', null, 'Geändert'), h('th'))), body)));
    }
    function load() {
      json('GET', '/admin/protocols').then(function (r) { rows = r; box.show(''); draw(); }).catch(function (e) { box.show(e.message); });
    }
    card.appendChild(h('div', { class: 'toolbar' }, search, filters));
    card.appendChild(list);
    card.appendChild(box);
    load();
    wrap.appendChild(pageHead('Protokolle', 'Hier siehst du veröffentlichte Protokolle und deine eigenen. Private Protokolle anderer Betreuer bleiben für dich unsichtbar.'));
    wrap.appendChild(card);
    return wrap;
  };

  VIEWS.layout = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    var card = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Lade …'));
    json('GET', '/admin/settings').then(function (s) {
      var box = msgBox();
      var org = h('input', { type: 'text', value: s.orgName, maxlength: 200 });
      var footer = h('input', { type: 'text', value: s.footer, maxlength: 200, placeholder: 'z. B. Freiwillige Feuerwehr Musterstadt' });
      var accent = h('input', { type: 'color', value: s.accent });
      var logo = s.logo;
      var prev = h('div');
      function drawLogo() {
        prev.textContent = '';
        if (logo) prev.appendChild(h('img', { class: 'logo-prev', src: logo, alt: 'Logo' }));
      }
      drawLogo();
      var file = h('input', { type: 'file', accept: 'image/png,image/jpeg', onchange: function () {
        var f = file.files[0];
        if (!f) return;
        if (f.size > 500000) { box.show('Logo ist größer als 500 KB.'); return; }
        var rd = new FileReader();
        rd.onload = function () { logo = String(rd.result); drawLogo(); };
        rd.readAsDataURL(f);
      } });
      var save = h('button', { class: 'btn primary', onclick: function () {
        run(save, box, function () { return json('PUT', '/admin/settings', { orgName: org.value, footer: footer.value, accent: accent.value, logo: logo }); }, 'Gespeichert.');
      } }, 'Speichern');
      var preview = h('button', { class: 'btn', onclick: function () {
        run(preview, box, function () { return download('/admin/preview.pdf', '', true); });
      } }, 'Vorschau (gespeicherter Stand)');
      card.textContent = '';
      card.appendChild(field('Organisation (Kopfzeile)', org));
      card.appendChild(field('Fußzeile', footer));
      card.appendChild(field('Akzentfarbe', accent));
      card.appendChild(h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Logo (PNG/JPEG, max. 500 KB)'));
      card.appendChild(prev);
      card.appendChild(h('div', { class: 'row', style: 'margin-bottom:14px' }, file, h('button', { class: 'btn small', onclick: function () { logo = ''; file.value = ''; drawLogo(); } }, 'Logo entfernen')));
      card.appendChild(h('div', { class: 'row' }, save, preview));
      card.appendChild(box);
    }).catch(function (e) { card.appendChild(h('div', { class: 'msg err' }, e.message)); });
    wrap.appendChild(pageHead('PDF-Layout', 'So sehen die PDFs aus, die aus Protokollen erzeugt werden. Änderungen gelten sofort für alle Geräte.'));
    wrap.appendChild(card);
    return wrap;
  };

  VIEWS.devices = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    var card = h('div', { class: 'card' });
    var box = msgBox();
    function load() {
      json('GET', '/admin/sessions').then(function (rows) {
        card.textContent = '';
        var body = h('tbody');
        rows.forEach(function (s) {
          body.appendChild(h('tr', null,
            h('td', null, s.device, s.current && h('span', { class: 'tag', style: 'margin-left:8px' }, 'dieses Gerät')),
            h('td', { class: 'muted' }, s.username || '–'),
            h('td', { class: 'muted' }, fmt(s.lastUsedAt)),
            h('td', { class: 'muted' }, fmt(s.expiresAt)),
            h('td', { class: 'act' }, !s.current && h('button', { class: 'btn small danger', onclick: function () { json('DELETE', '/admin/sessions/' + s.id).then(load); } }, 'Abmelden'))));
        });
        card.appendChild(h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Gerät'), h('th', null, 'Benutzer'), h('th', null, 'Zuletzt aktiv'), h('th', null, 'Läuft ab'), h('th'))), body)));
        card.appendChild(box);
      }).catch(function (e) { box.show(e.message); });
    }
    load();
    wrap.appendChild(pageHead('Geräte', 'Alle Handys und Browser, die angemeldet sind. Verlorene Geräte meldest du hier ab; jeder Betreuer verwaltet seine eigenen Geräte auch in der App unter Einstellungen.'));
    wrap.appendChild(card);
    return wrap;
  };

  VIEWS.security = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    var box = msgBox();
    var cur = h('input', { type: 'password', autocomplete: 'current-password' });
    var nw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
    var btn = h('button', { class: 'btn primary', type: 'submit' }, 'Passwort ändern');
    var pwCard = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      run(btn, box, function () { return json('POST', '/account/password', { current: cur.value, next: nw.value }).then(function () { cur.value = ''; nw.value = ''; }); }, 'Passwort geändert. Deine anderen Geräte wurden abgemeldet.');
    } }, h('h2', null, 'Eigenes Passwort ändern'), field('Aktuelles Passwort', cur), field('Neues Passwort (mind. 10 Zeichen)', nw), btn, box);

    var box2 = msgBox();
    var days = h('input', { type: 'number', min: 1, max: 365 });
    var trash = h('input', { type: 'number', min: 1, max: 3650 });
    var sv = h('button', { class: 'btn primary', type: 'submit' }, 'Speichern');
    var setCard = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      run(sv, box2, function () { return json('PUT', '/admin/settings', { tokenDays: String(days.value), trashDays: String(trash.value) }); }, 'Gespeichert.');
    } }, h('h2', null, 'Laufzeiten'),
      field('Anmeldung bleibt gültig (Tage ohne Nutzung)', days),
      field('Papierkorb wird geleert nach (Tage)', trash), sv, box2);
    json('GET', '/admin/settings').then(function (s) { days.value = s.tokenDays; trash.value = s.trashDays; });
    wrap.appendChild(pageHead('Konto & Laufzeiten', 'Dein eigenes Passwort sowie Laufzeiten für Anmeldungen und Papierkorb (gelten für alle).'));
    wrap.appendChild(pwCard);
    wrap.appendChild(setCard);
    return wrap;
  };

  VIEWS.users = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    var card = h('div', { class: 'card' });
    var box = msgBox();
    var inviteBox = h('div');
    var me = state.me;

    /** Einladungslink für die Web-App; das Passwort vergibt der Betreuer selbst. */
    function showInvite(user, invite) {
      var link = location.origin + '/#/einladung?u=' + encodeURIComponent(user.username) + '&c=' + encodeURIComponent(invite.code);
      var field = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Einladungslink', onfocus: function () { field.select(); } });
      inviteBox.textContent = '';
      inviteBox.appendChild(h('div', { class: 'card', style: 'border-color:var(--accent,#c0392b)' },
        h('h2', null, 'Einladung für ' + (user.displayName || user.username)),
        h('p', { class: 'small muted' }, 'Gib diesen Link weiter (nur einmal verwendbar, gültig bis ' + fmt(invite.expiresAt) + '). Beim Öffnen vergibt die Person ihr eigenes Passwort. Alternativ: Benutzername „' + user.username + '“ und Code ' + invite.code + ' in der App unter „Einladung einlösen“.'),
        field,
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn small', onclick: function () { navigator.clipboard && navigator.clipboard.writeText(link).then(function () { box.show('Link kopiert.', true); }); } }, 'Link kopieren'),
          h('button', { class: 'btn small', onclick: function () { inviteBox.textContent = ''; } }, 'Schließen'))));
      field.focus();
      field.select();
    }

    function load() {
      json('GET', '/admin/users').then(function (rows) {
        card.textContent = '';
        var body = h('tbody');
        rows.forEach(function (u) {
          var self = me && me.id === u.id;
          var status = u.disabled ? 'gesperrt' : u.invited ? 'eingeladen' : 'aktiv';
          var acts = h('td', { class: 'act' });
          acts.appendChild(h('button', { class: 'btn small', onclick: function () {
            json('POST', '/admin/users/' + u.id + '/invite').then(function (inv) { showInvite(u, inv); }, function (e) { box.show(e.message); });
          } }, u.invited ? 'Neuer Link' : 'Passwort zurücksetzen'));
          if (!self) {
            acts.appendChild(document.createTextNode(' '));
            acts.appendChild(h('button', { class: 'btn small', onclick: function () {
              json('PATCH', '/admin/users/' + u.id, { disabled: !u.disabled }).then(load, function (e) { box.show(e.message); });
            } }, u.disabled ? 'Entsperren' : 'Sperren'));
            acts.appendChild(document.createTextNode(' '));
            acts.appendChild(h('button', { class: 'btn small', onclick: function () {
              json('PATCH', '/admin/users/' + u.id, { role: u.role === 'admin' ? 'betreuer' : 'admin' }).then(load, function (e) { box.show(e.message); });
            } }, u.role === 'admin' ? 'Zum Betreuer machen' : 'Zum Admin machen'));
            acts.appendChild(document.createTextNode(' '));
            acts.appendChild(h('button', { class: 'btn small danger', onclick: function () {
              confirmBox('Benutzer löschen?', '„' + u.username + '“ wird entfernt. Private Protokolle und Aufgaben dieser Person werden gelöscht, veröffentlichte gehören danach dir.', 'Löschen').then(function (ok) {
                if (ok) json('DELETE', '/admin/users/' + u.id).then(load, function (e) { box.show(e.message); });
              });
            } }, 'Löschen'));
          }
          body.appendChild(h('tr', null,
            h('td', null, u.displayName, self && h('span', { class: 'tag', style: 'margin-left:8px' }, 'du')),
            h('td', { class: 'muted' }, u.username),
            h('td', null, h('span', { class: 'tag' }, u.role === 'admin' ? 'Admin' : 'Betreuer')),
            h('td', { class: 'muted' }, status + (u.lastLoginAt ? ' · zuletzt ' + fmt(u.lastLoginAt) : '')),
            acts));
        });
        card.appendChild(h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Benutzername'), h('th', null, 'Rolle'), h('th', null, 'Status'), h('th'))), body)));
      }).catch(function (e) { box.show(e.message); });
    }

    var uname = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'z. B. anna' });
    var dname = h('input', { type: 'text', autocomplete: 'off', maxlength: 60, placeholder: 'z. B. Anna Beispiel' });
    var role = h('select', null, h('option', { value: 'betreuer' }, 'Betreuer'), h('option', { value: 'admin' }, 'Admin (darf alles verwalten)'));
    var add = h('button', { class: 'btn primary', type: 'submit' }, 'Betreuer einladen');
    var addBox = msgBox();
    var form = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      run(add, addBox, function () {
        return json('POST', '/admin/users', { username: uname.value, displayName: dname.value, role: role.value }).then(function (r) {
          uname.value = ''; dname.value = '';
          showInvite(r.user, r.invite);
          load();
        });
      });
    } }, h('h2', null, 'Neuen Benutzer anlegen'),
      field('Benutzername', uname), field('Anzeigename', dname), field('Rolle', role), add, addBox);

    load();
    wrap.appendChild(pageHead('Benutzer', 'Jeder Betreuer hat ein eigenes Konto. Du legst es an, die Person vergibt ihr Passwort selbst über den Einladungslink.'));
    wrap.appendChild(inviteBox);
    wrap.appendChild(card);
    wrap.appendChild(box);
    wrap.appendChild(form);
    return wrap;
  };

  var KIND = { auto: 'automatisch', manuell: 'manuell', vorher: 'vor Wiederherstellung' };
  var RESTORE_WARN = 'Alle aktuellen Daten werden durch den Stand der Sicherung ersetzt, auch Benutzer und Anmeldungen. ' +
    'Vorher legt der Server automatisch eine Sicherung des jetzigen Stands an. ' +
    'Die Geräte gleichen sich danach neu ab und senden hoch, was in der Sicherung fehlt. Wer in der Sicherung nicht existierte, muss sich neu anmelden.';

  function restoreDone(msgBox, r) {
    msgBox.show('Wiederhergestellt. Der vorherige Stand liegt als „' + r.before + '“ in der Liste. Du wirst neu angemeldet, falls nötig …', true);
    setTimeout(render, 1500);
  }

  VIEWS.backup = function () {
    var wrap = h('div', { class: 'page', style: 'display:grid;gap:16px' });
    wrap.appendChild(pageHead('Backup & Export', 'Der Server sichert die Datenbank täglich selbst. Hier siehst du die Sicherungen, lädst sie herunter und stellst sie wieder her.'));

    // --- gespeicherte Backups ---
    var box = msgBox();
    var listBox = h('div');
    var keep = h('input', { type: 'number', min: 0, max: 365 });
    var saveKeep = h('button', { class: 'btn', type: 'submit' }, 'Speichern');
    var now = h('button', { class: 'btn primary', onclick: function () { run(now, box, function () { return json('POST', '/admin/backups').then(load); }, 'Backup angelegt.'); } }, 'Jetzt sichern');
    var keepForm = h('form', { onsubmit: function (e) {
      e.preventDefault();
      run(saveKeep, box, function () { return json('PUT', '/admin/settings', { backupKeep: String(keep.value || 0) }); }, 'Gespeichert.');
    } }, field('Wie viele automatische Backups aufheben? (0 = keine automatischen Backups)', keep), saveKeep);

    function draw(info) {
      listBox.textContent = '';
      keep.value = info.keep;
      if (!info.enabled) {
        listBox.appendChild(h('div', { class: 'empty' }, 'Auf diesem Server ist kein Backup-Ordner eingerichtet.'));
        now.disabled = true;
        return;
      }
      if (!info.items.length) {
        listBox.appendChild(h('div', { class: 'empty' }, 'Noch keine Backups. Das erste automatische Backup entsteht kurz nach dem Start; du kannst auch jetzt eines anlegen.'));
        return;
      }
      var body = h('tbody');
      info.items.forEach(function (b) {
        var acts = h('td', { class: 'act' },
          h('button', { class: 'btn small', onclick: function () { download('/admin/backups/' + encodeURIComponent(b.name), b.name).catch(function (e) { box.show(e.message); }); } }, 'Laden'), ' ',
          h('button', { class: 'btn small', onclick: function () {
            confirmBox('Diesen Stand wiederherstellen?', fmt(b.createdAt) + ' (' + KIND[b.kind] + '). ' + RESTORE_WARN, 'Wiederherstellen').then(function (ok) {
              if (ok) json('POST', '/admin/backups/' + encodeURIComponent(b.name) + '/restore').then(function (r) { restoreDone(box, r); }, function (e) { box.show(e.message); });
            });
          } }, 'Wiederherstellen'), ' ',
          h('button', { class: 'btn small danger', onclick: function () {
            confirmBox('Backup löschen?', fmt(b.createdAt) + ' wird unwiderruflich entfernt.', 'Löschen').then(function (ok) {
              if (ok) json('DELETE', '/admin/backups/' + encodeURIComponent(b.name)).then(load, function (e) { box.show(e.message); });
            });
          } }, 'Löschen'));
        body.appendChild(h('tr', null, h('td', null, fmt(b.createdAt)), h('td', null, h('span', { class: 'tag' }, KIND[b.kind])), h('td', { class: 'muted' }, fmtSize(b.size)), acts));
      });
      listBox.appendChild(h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Zeitpunkt'), h('th', null, 'Art'), h('th', null, 'Größe'), h('th'))), body)));
    }
    function load() {
      return json('GET', '/admin/backups').then(draw).catch(function (e) { box.show(e.message); });
    }
    load();
    wrap.appendChild(h('div', { class: 'card' }, h('h2', null, 'Gespeicherte Backups'),
      h('p', { class: 'muted' }, 'Sie liegen im Datenordner des Servers (/data/backups) und schützen vor Fehlern und versehentlichem Löschen. ' +
        'Fällt die ganze Festplatte aus, sind sie mit weg: Lade deshalb ab und zu ein Backup herunter oder sichere das Volume an anderer Stelle.'),
      h('div', { class: 'row' }, now), keepForm, box, listBox));

    // --- aus Datei ---
    var box2 = msgBox();
    var file = h('input', { type: 'file', accept: '.sqlite,application/octet-stream' });
    var up = h('button', { class: 'btn', type: 'submit' }, 'Aus Datei wiederherstellen');
    wrap.appendChild(h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      var f = file.files && file.files[0];
      if (!f) return box2.show('Bitte zuerst eine Backup-Datei (.sqlite) auswählen.');
      confirmBox('Aus „' + f.name + '“ wiederherstellen?', RESTORE_WARN, 'Wiederherstellen').then(function (ok) {
        if (!ok) return;
        run(up, box2, function () {
          return fetch('/api/admin/restore', { method: 'POST', credentials: 'same-origin', headers: { 'X-JFH': '1', 'Content-Type': 'application/x-sqlite3' }, body: f })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status); return j; }); })
            .then(function (r) { restoreDone(box2, r); load(); });
        });
      });
    } }, h('h2', null, 'Aus Datei wiederherstellen'),
      h('p', { class: 'muted' }, 'Eine Datei, die du über „Datenbank-Backup laden“ (oder aus dem Backup-Ordner) bekommen hast. Auch Sicherungen älterer Versionen sind möglich.'),
      field('Backup-Datei', file), up, box2));

    // --- Downloads ---
    var box3 = msgBox();
    var b1 = h('button', { class: 'btn primary', onclick: function () { run(b1, box3, function () { return download('/admin/backup', 'jf-hub-backup.sqlite'); }); } }, 'Aktuelles Datenbank-Backup laden');
    var b2 = h('button', { class: 'btn', onclick: function () { run(b2, box3, function () { return download('/export.zip', 'protokolle.zip'); }); } }, 'Alle Protokolle als ZIP (PDF + JSON)');
    wrap.appendChild(h('div', { class: 'card' }, h('h2', null, 'Herunterladen'),
      h('p', { class: 'muted' }, 'Das Backup enthält alle Daten, auch Fotos und Anhänge. Verschlüsselt und nicht in einer fremden Cloud ablegen.'),
      h('div', { class: 'row' }, b1, b2), box3));
    return wrap;
  };

  // ---------- Start ----------
  function render() {
    fetch('/api/status').then(function (r) { return r.json(); }).then(function (st) {
      state.status = st;
      if (st.setupRequired) return setView(authView(true));
      return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
        if (r.status !== 200) return setView(authView(false));
        return r.json().then(function (me) {
          state.me = me.user;
          document.title = 'JF Hub – Server';
          if (me.user.role !== 'admin') {
            return setView(h('div', { class: 'center' }, h('div', { class: 'card' },
              h('h2', null, 'Nur für Admins'),
              h('p', { class: 'muted' }, 'Du bist als „' + me.user.username + '“ angemeldet. Die Server-Verwaltung ist Admins vorbehalten.'),
              h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '/' }, 'Zur App'),
                h('button', { class: 'btn', onclick: function () { json('POST', '/logout').then(render, render); } }, 'Abmelden')))));
          }
          setView(shell(VIEWS[currentTab()]()));
        });
      });
    }).catch(function () { setView(h('div', { class: 'center' }, h('div', { class: 'msg err' }, 'Server nicht erreichbar.'))); });
  }
  function setView(el) { root.textContent = ''; root.appendChild(el); }
  window.addEventListener('hashchange', render);
  render();
})();
