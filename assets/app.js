/* ==========================================================================
   Vocabulary trainer
   No word data lives in this file. Everything is read from:
     data/manifest.json           the letter index
     data/words/<letter>/*.json   the words themselves
     data/quiz/config.json        quiz behaviour
   To add words, edit the JSON. To add a file, list it in the manifest.
   ========================================================================== */
(function () {
  'use strict';

  var MANIFEST = null;
  var QUIZCFG = null;
  var CACHE = {};            // letter -> array of words
  var ALL_LOADED = false;
  var view = [];             // what the current tab is showing
  var tab = 'home';
  var letter = 'a';
  var shown = 40, PAGE = 40;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var shuffle = function (a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var norm = function (s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); };

  var DOT = { IELTS: 'project', GRE: 'publication', BOTH: 'experience' };
  var LEVEL_LABEL = { IELTS: 'IELTS', GRE: 'GRE', BOTH: 'IELTS + GRE' };

  /* --- saved progress (silently session-only if storage is blocked) --- */
  var KEY = 'vocab.progress.v2';
  var save = { known: {}, spelled: {} };
  try { save = Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }

  /* ====================================================================
     BOOT
     ==================================================================== */
  Promise.all([
    fetch('data/manifest.json').then(function (r) { return r.json(); }),
    fetch('data/quiz/config.json').then(function (r) { return r.json(); })
  ]).then(function (res) {
    MANIFEST = res[0];
    QUIZCFG = res[1];
    $('bootState').remove();          // gone entirely, not just hidden
    $('app').classList.remove('is-hidden');
    buildRail();
    fillTotals();
    switchTab('home');
  }).catch(function () {
    $('bootTitle').textContent = 'Can\u2019t read the data folder';
    $('bootMsg').innerHTML =
      'A page opened straight from disk isn\u2019t allowed to read its own files. ' +
      'Open a terminal in this folder and run <code>python -m http.server</code>, ' +
      'then visit <code>http://localhost:8000/</code>.';
  });

  function fillTotals() {
    var t = MANIFEST.totals || {};
    $('tWords').textContent = t.words || 0;
    $('tIelts').textContent = t.ielts || 0;
    $('tGre').textContent = t.gre || 0;
    $('tBoth').textContent = t.both || 0;
    $('nIelts').textContent = t.ielts || 0;
    $('nGre').textContent = t.gre || 0;
    $('nBoth').textContent = t.both || 0;
    updateProgress();
  }

  function updateProgress() {
    var n = Object.keys(save.known).length;
    var total = (MANIFEST.totals && MANIFEST.totals.words) || 1;
    $('knownN').textContent = n;
    $('knownBar').style.width = Math.min(100, n / total * 100) + '%';
  }

  /* ====================================================================
     DATA LOADING
     ==================================================================== */
  function letterInfo(L) {
    return (MANIFEST.letters || []).filter(function (x) { return x.letter === L; })[0];
  }

  function loadLetter(L) {
    if (CACHE[L]) return Promise.resolve(CACHE[L]);
    var info = letterInfo(L);
    if (!info || !info.parts.length) { CACHE[L] = []; return Promise.resolve([]); }
    return Promise.all(info.parts.map(function (p) {
      return fetch('data/words/' + L + '/' + p).then(function (r) { return r.json(); });
    })).then(function (chunks) {
      var out = [];
      chunks.forEach(function (c) { out = out.concat(c); });
      out.forEach(function (w) {
        if (!Array.isArray(w.syn)) w.syn = [];
        if (!Array.isArray(w.ant)) w.ant = [];
      });
      CACHE[L] = out;
      return out;
    });
  }

  function loadAll() {
    if (ALL_LOADED) return Promise.resolve(everything());
    var live = (MANIFEST.letters || []).filter(function (x) { return x.count > 0; });
    return Promise.all(live.map(function (x) { return loadLetter(x.letter); }))
      .then(function () { ALL_LOADED = true; return everything(); });
  }

  function everything() {
    var out = [];
    Object.keys(CACHE).forEach(function (k) { out = out.concat(CACHE[k]); });
    return out;
  }

  /* ====================================================================
     LETTER RAIL + FILTERS
     ==================================================================== */
  function buildRail() {
    var html = '<button class="rail-all" data-letter="*">All letters</button>';
    (MANIFEST.letters || []).forEach(function (x) {
      html += '<button data-letter="' + x.letter + '"' + (x.count ? '' : ' disabled') +
        ' title="' + x.count + ' words">' + x.letter + '</button>';
    });
    $('rail').innerHTML = html;
    $('rail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-letter]');
      if (!b || b.disabled) return;
      letter = b.getAttribute('data-letter');
      shown = PAGE;
      load();
    });
  }

  function markRail() {
    // A search always spans every letter, so no single letter is "current".
    var active = searching() ? '*' : letter;
    Array.prototype.forEach.call($('rail').querySelectorAll('[data-letter]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-letter') === active));
    });
  }

  function searching() { return $('q').value.trim() !== ''; }

  function countLabel() {
    var n = view.length;
    var noun = n + ' word' + (n === 1 ? '' : 's');
    if (searching()) return '<strong>' + noun + '</strong> matching your search';
    if (letter === '*') return '<strong>' + noun + '</strong> across every letter';
    return '<strong>' + noun + '</strong> beginning with ' + letter.toUpperCase();
  }

  function scope() {
    if (tab === 'ielts') return function (w) { return w.level === 'IELTS' || w.level === 'BOTH'; };
    if (tab === 'gre') return function (w) { return w.level === 'GRE' || w.level === 'BOTH'; };
    return function () { return true; };
  }

  // Fetch what the current tab needs, then filter and render.
  function load() {
    var q = $('q').value.trim();
    var need = (letter === '*' || q) ? loadAll() : loadLetter(letter);
    setBusy(true);
    need.then(function (words) {
      setBusy(false);
      if (letter !== '*' && !q) words = CACHE[letter] || [];
      apply(words);
    });
  }

  function setBusy(on) {
    $('busy').classList.toggle('is-hidden', !on);
  }

  function apply(words) {
    var q = norm($('q').value);
    var pos = $('fPos').value;
    var hide = $('fShow').value;

    view = words.filter(scope()).filter(function (w) {
      if (pos && w.pos !== pos) return false;
      if (hide === 'unlearned' && save.known[w.id]) return false;
      if (hide === 'learned' && !save.known[w.id]) return false;
      if (!q) return true;
      return norm(w.word + ' ' + w.def + ' ' + w.syn.join(' ') + ' ' + w.ant.join(' ')).indexOf(q) > -1;
    });
    view.sort(function (a, b) { return a.word.localeCompare(b.word); });

    buildPosOptions(words);
    markRail();
    if (tab === 'pairs') renderPairs(); else renderGrid();
  }

  var posBuilt = false;
  function buildPosOptions(words) {
    if (posBuilt) return;
    var seen = {};
    words.forEach(function (w) { if (w.pos) seen[w.pos] = 1; });
    var keys = Object.keys(seen).sort();
    if (!keys.length) return;
    $('fPos').innerHTML = '<option value="">All word types</option>' +
      keys.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
    posBuilt = true;
  }

  ['q', 'fPos', 'fShow'].forEach(function (id) {
    $(id).addEventListener('input', function () { shown = PAGE; load(); });
  });

  /* ====================================================================
     WORD GRID
     ==================================================================== */
  function renderGrid() {
    var slice = view.slice(0, shown);
    $('grid').innerHTML = slice.map(function (w) {
      return '<button class="word-card' + (save.known[w.id] ? ' is-known' : '') + '" data-id="' + w.id + '">' +
        '<span class="wc-top">' +
          '<span class="wc-id">' + String(w.id).padStart(4, '0') + '</span>' +
          '<span class="wc-level"><span class="tag-dot ' + (DOT[w.level] || 'project') + '"></span>' +
            esc(LEVEL_LABEL[w.level] || w.level) + '</span>' +
        '</span>' +
        '<span class="wc-head"><span class="wc-word">' + esc(w.word) + '</span>' +
          '<span class="wc-pos">' + esc(w.pos) + '</span></span>' +
        '<span class="wc-def">' + esc(w.def) + '</span>' +
        '<span class="wc-foot"><span>List ' + esc(w.list) + '</span>' +
          '<span class="' + (save.known[w.id] ? 'wc-known-flag' : '') + '">' +
          (save.known[w.id] ? '\u2713 Learned' : 'Open card') + '</span></span>' +
      '</button>';
    }).join('') || emptyState();

    $('count').innerHTML = countLabel();
    $('moreWrap').classList.toggle('is-hidden', shown >= view.length);
  }

  function emptyState() {
    if (searching() && (tab === 'ielts' || tab === 'gre')) {
      var other = tab === 'ielts' ? 'gre' : 'ielts';
      return '<div class="state-panel"><h3>No match on this list</h3>' +
        '<p>Nothing in the ' + (tab === 'ielts' ? 'IELTS' : 'GRE') + ' words matches that. ' +
        'It may still be on the <button class="link-btn" data-go="' + other + '">' +
        (other === 'gre' ? 'GRE' : 'IELTS') + ' list</button>.</p></div>';
    }
    if (searching()) {
      return '<div class="state-panel"><h3>No match</h3>' +
        '<p>Nothing matches that search. Try a shorter word, or part of a definition.</p></div>';
    }
    return '<div class="state-panel"><h3>Nothing here yet</h3>' +
      '<p>No word in this letter fits the filters. Pick another letter, or reset the filters above.</p></div>';
  }

  $('more').addEventListener('click', function () { shown += PAGE; renderGrid(); });

  $('grid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-id]');
    if (b) openCard(+b.getAttribute('data-id'));
  });

  /* ====================================================================
     WORD CARD — detail panel with the spelling drill
     ==================================================================== */
  var openId = null, masked = false;

  function byId(id) {
    return view.filter(function (w) { return w.id === id; })[0] ||
           everything().filter(function (w) { return w.id === id; })[0];
  }

  function highlight(sentence, word) {
    var stem = word.replace(/(e|y)$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(sentence).replace(new RegExp('\\b(' + stem + '\\w*)', 'i'), '<b>$1</b>');
  }

  function openCard(id, startMasked) {
    var w = byId(id);
    if (!w) return;
    openId = id;
    masked = !!startMasked;
    drawCard();
    $('overlay').classList.add('is-open');
    document.body.style.overflow = 'hidden';
    if (masked) setTimeout(function () { var i = $('spellIn'); if (i) i.focus(); }, 30);
    else $('closeCard').focus();
  }

  function closeCard() {
    $('overlay').classList.remove('is-open');
    document.body.style.overflow = '';
    openId = null;
  }

  function drawCard() {
    var w = byId(openId);
    if (!w) return;
    var i = view.findIndex(function (x) { return x.id === openId; });

    var rows = '';
    rows += '<div class="wd-row"><span class="wd-key">Similar</span><span class="wd-syn">' +
      (w.syn.length ? esc(w.syn.join(', ')) : '<span class="pair-none">not recorded</span>') + '</span></div>';
    rows += '<div class="wd-row"><span class="wd-key">Opposite</span><span class="wd-ant">' +
      (w.ant.length ? esc(w.ant.join(', ')) : '<span class="pair-none">not recorded</span>') + '</span></div>';

    var streak = save.spelled[w.id] || 0;

    $('cardBody').innerHTML =
      '<div class="wd-head">' +
        '<h2 class="wd-word' + (masked ? ' is-masked' : '') + '" id="wdWord">' + esc(w.word) + '</h2>' +
        '<p class="wd-pos">' + esc(w.pos) + ' &middot; ' + esc(LEVEL_LABEL[w.level] || w.level) +
          ' &middot; list ' + esc(w.list) + '</p>' +
      '</div>' +
      '<div class="wd-body">' +
        '<p class="wd-def">' + esc(w.def) + '</p>' + rows +
        (w.ex ? '<p class="wd-ex' + (masked ? ' is-masked' : '') + '">' + highlight(w.ex, w.word) + '</p>' : '') +
        '<div class="spell-drill">' +
          '<div class="spell-head">' +
            '<span class="spell-title">' + (masked ? 'Spell it from the meaning' : 'Spelling check') + '</span>' +
            '<span class="spell-streak">' + (streak ? streak + ' correct' : '') + '</span>' +
          '</div>' +
          '<p class="spell-lede" id="spellLede">' +
            (masked ? 'The word is blurred. Read the definition, then type it.'
                    : 'Hide the word and type it back from the meaning.') + '</p>' +
          (masked
            ? '<div class="spell-form">' +
                '<input type="text" id="spellIn" autocomplete="off" autocapitalize="off" ' +
                  'autocorrect="off" spellcheck="false" placeholder="Type the word" aria-label="Type the word">' +
                '<button class="btn btn-primary" id="spellGo">Check</button>' +
              '</div>' +
              '<p class="spell-msg" id="spellMsg" role="status" aria-live="polite"></p>' +
              '<div class="spell-actions">' +
                '<button class="btn" id="spellReveal">Show the word</button>' +
                '<button class="btn" id="spellOff">Stop testing</button>' +
              '</div>'
            : '<div class="spell-actions"><button class="btn btn-primary" id="spellOn">Start the spelling test</button></div>') +
        '</div>' +
      '</div>' +
      '<div class="wd-foot">' +
        '<button class="btn" id="markBtn">' + (save.known[w.id] ? '\u2713 Learned \u2014 undo' : 'Mark learned') + '</button>' +
        '<span class="wd-nav">' +
          '<button class="btn" id="prevW"' + (i <= 0 ? ' disabled' : '') + '>&larr; Previous</button>' +
          '<button class="btn" id="nextW"' + (i < 0 || i >= view.length - 1 ? ' disabled' : '') + '>Next &rarr;</button>' +
        '</span>' +
      '</div>';

    wire(w);
  }

  function wire(w) {
    var on = $('spellOn'), off = $('spellOff'), go = $('spellGo'),
        rev = $('spellReveal'), input = $('spellIn');

    if (on) on.onclick = function () { masked = true; drawCard(); $('spellIn').focus(); };
    if (off) off.onclick = function () { masked = false; drawCard(); };
    if (rev) rev.onclick = function () {
      $('wdWord').classList.remove('is-masked');
      var ex = document.querySelector('.wd-ex');
      if (ex) ex.classList.remove('is-masked');
      say('wrong', 'It was <b>' + esc(w.word) + '</b>. Close the card and come back to it later.');
    };
    if (go) go.onclick = function () { check(w); };
    if (input) input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); check(w); }
    };

    $('markBtn').onclick = function () {
      if (save.known[w.id]) delete save.known[w.id]; else save.known[w.id] = 1;
      persist(); updateProgress(); drawCard();
      if (tab === 'pairs') renderPairs(); else renderGrid();
    };
    var i = view.findIndex(function (x) { return x.id === openId; });
    $('prevW').onclick = function () { if (i > 0) openCard(view[i - 1].id, masked); };
    $('nextW').onclick = function () { if (i < view.length - 1) openCard(view[i + 1].id, masked); };
  }

  function say(kind, html) {
    var m = $('spellMsg');
    if (!m) return;
    m.className = 'spell-msg ' + kind;
    m.innerHTML = html;
  }

  function check(w) {
    var input = $('spellIn');
    var typed = input.value.trim();
    if (!typed) return;
    input.classList.remove('is-right', 'is-wrong');

    if (norm(typed) === norm(w.word)) {
      input.classList.add('is-right');
      $('wdWord').classList.remove('is-masked');
      var ex = document.querySelector('.wd-ex');
      if (ex) ex.classList.remove('is-masked');
      save.spelled[w.id] = (save.spelled[w.id] || 0) + 1;
      persist();
      var n = save.spelled[w.id];
      var badge = document.querySelector('.spell-streak');
      if (badge) badge.textContent = n + ' correct';
      say('right', 'Correct' + (n > 1 ? ' \u2014 ' + n + ' times now' : '') +
        '. <button class="link-btn" id="spellNext">Next word</button>');
      var nx = $('spellNext');
      if (nx) nx.onclick = function () {
        var i = view.findIndex(function (x) { return x.id === openId; });
        if (i < view.length - 1) openCard(view[i + 1].id, true); else closeCard();
      };
    } else {
      input.classList.add('is-wrong');
      say('wrong', 'Not yet. ' + diff(typed, w.word));
      input.select();
    }
  }

  // Show how far the attempt got before diverging, without giving the rest away.
  function diff(typed, actual) {
    var a = norm(typed), b = norm(actual), i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i === 0) return 'The first letter is <b>' + esc(actual[0]) + '</b>.';
    return 'Right up to <span class="near">' + esc(actual.slice(0, i)) +
      '<s>' + '\u00b7'.repeat(Math.max(1, actual.length - i)) + '</s></span> \u2014 ' +
      (actual.length === a.length ? 'check the middle.' : 'it has ' + actual.length + ' letters.');
  }

  $('closeCard').addEventListener('click', closeCard);
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) closeCard(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openId != null) closeCard();
  });

  /* ====================================================================
     SYNONYMS & ANTONYMS TABLE
     ==================================================================== */
  var pairHide = 'none';

  function renderPairs() {
    var rows = view.slice(0, shown).map(function (w) {
      var synCell = w.syn.length ? esc(w.syn.join(', ')) : '<span class="pair-none">\u2014</span>';
      var antCell = w.ant.length ? esc(w.ant.join(', ')) : '<span class="pair-none">\u2014</span>';
      return '<div class="pair-row' + (pairHide !== 'none' ? ' is-hidden-col' : '') + '">' +
        '<div class="pair-cell"><button class="pair-word" data-id="' + w.id + '">' + esc(w.word) +
          '<em>' + esc(w.pos) + '</em></button></div>' +
        '<div class="pair-cell pair-syn' + (pairHide === 'syn' ? ' masked' : '') + '">' + synCell + '</div>' +
        '<div class="pair-cell pair-ant' + (pairHide === 'ant' ? ' masked' : '') + '">' + antCell + '</div>' +
      '</div>';
    }).join('');

    $('pairs').innerHTML = rows
      ? '<div class="pair-table">' +
          '<div class="pair-row head">' +
            '<div class="pair-cell">Word</div>' +
            '<div class="pair-cell">Similar meaning</div>' +
            '<div class="pair-cell">Opposite meaning</div>' +
          '</div>' + rows +
        '</div>'
      : emptyState();

    $('count').innerHTML = countLabel();
    $('moreWrap').classList.toggle('is-hidden', shown >= view.length);
  }

  $('pairs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-id]');
    if (b) openCard(+b.getAttribute('data-id'));
  });

  $('pairHide').addEventListener('change', function () {
    pairHide = this.value;
    renderPairs();
  });

  /* ====================================================================
     QUIZ
     ==================================================================== */
  var quiz = null;

  function quizIntro() {
    $('quizStage').innerHTML =
      '<div class="state-panel">' +
        '<h3>' + QUIZCFG.roundLength + ' questions</h3>' +
        '<p>Meanings, matching words, synonyms, opposites, gap-fills and spelling. ' +
          'Answer with the mouse or press 1\u2013' + QUIZCFG.optionCount + '.</p>' +
        '<p style="margin-top:14px;">' +
          '<label class="sr-only" for="quizScope">Words to draw from</label>' +
          '<select id="quizScope" style="font:inherit;padding:8px 10px;border:1px solid var(--rule);">' +
            '<option value="all">Every word</option>' +
            '<option value="IELTS">IELTS words only</option>' +
            '<option value="GRE">GRE words only</option>' +
            '<option value="unlearned">Only words I haven\u2019t learned</option>' +
          '</select></p>' +
        '<p style="margin-top:12px;"><button class="btn btn-primary" id="quizStart">Start the quiz</button></p>' +
      '</div>';
    $('quizStart').onclick = function () {
      var s = $('quizScope').value;
      setBusy(true);
      loadAll().then(function (all) {
        setBusy(false);
        var pool = all.filter(function (w) {
          if (s === 'IELTS') return w.level === 'IELTS' || w.level === 'BOTH';
          if (s === 'GRE') return w.level === 'GRE' || w.level === 'BOTH';
          if (s === 'unlearned') return !save.known[w.id];
          return true;
        });
        if (pool.length < QUIZCFG.optionCount) pool = all;
        startQuiz(pool);
      });
    };
  }

  function weightedType(w) {
    var ok = QUIZCFG.types.filter(function (t) {
      if (t.needs === 'syn') return w.syn.length > 0;
      if (t.needs === 'ant') return w.ant.length > 0;
      if (t.needs === 'ex') return !!w.ex;
      return !!w.def;
    });
    var bag = [];
    ok.forEach(function (t) { for (var i = 0; i < (t.weight || 1); i++) bag.push(t); });
    return pick(bag);
  }

  function buildQuestion(pool) {
    var w = pick(pool);
    var t = weightedType(w);
    var others = shuffle(pool.filter(function (x) { return x.id !== w.id; })).slice(0, QUIZCFG.optionCount - 1);
    var q = { word: w, kind: t.id, kicker: t.label };

    if (t.id === 'def') {
      q.cue = esc(w.word) + ' <em>' + esc(w.pos) + '</em>';
      q.answer = w.def;
      q.options = [w.def].concat(others.map(function (x) { return x.def; }));
    } else if (t.id === 'word') {
      q.prompt = w.def;
      q.answer = w.word;
      q.options = [w.word].concat(others.map(function (x) { return x.word; }));
    } else if (t.id === 'syn') {
      q.cue = esc(w.word);
      q.answer = pick(w.syn);
      q.options = [q.answer].concat(others.map(function (x) { return x.syn.length ? pick(x.syn) : x.word; }));
    } else if (t.id === 'ant') {
      q.cue = esc(w.word);
      q.answer = pick(w.ant);
      q.options = [q.answer].concat(others.map(function (x) { return x.ant.length ? pick(x.ant) : x.word; }));
    } else if (t.id === 'cloze') {
      q.prompt = blank(w.ex, w.word);
      q.answer = w.word;
      q.options = [w.word].concat(others.map(function (x) { return x.word; }));
    } else {                                   // spell
      q.typed = true;
      q.prompt = w.def;
      q.answer = w.word;
    }

    if (q.options) {
      q.options = q.options.filter(function (o, i, a) { return o && a.indexOf(o) === i; });
      var guard = 0;
      while (q.options.length < QUIZCFG.optionCount && guard++ < 60) {
        var extra = pick(pool).word;
        if (q.options.indexOf(extra) === -1) q.options.push(extra);
      }
      q.options = shuffle(q.options);
    }
    return q;
  }

  function blank(sentence, word) {
    var stem = word.replace(/(e|y)$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sentence.replace(new RegExp('\\b' + stem + '\\w*', 'i'), '\u2014\u2014\u2014\u2014');
  }

  function startQuiz(pool) {
    quiz = { i: 0, score: 0, missed: [], qs: [], answered: false, pool: pool };
    for (var n = 0; n < QUIZCFG.roundLength; n++) quiz.qs.push(buildQuestion(pool));
    renderQuestion();
  }

  function renderQuestion() {
    var q = quiz.qs[quiz.i];
    var head =
      '<div class="quiz-meter"><span>Question ' + (quiz.i + 1) + ' of ' + QUIZCFG.roundLength +
        '</span><span>Score ' + quiz.score + '</span></div>' +
      '<div class="meter-track"><div class="meter-fill" style="width:' +
        (quiz.i / QUIZCFG.roundLength * 100) + '%"></div></div>' +
      '<p class="quiz-kicker">' + esc(q.kicker) + '</p>' +
      (q.cue ? '<p class="quiz-cue">' + q.cue + '</p>' : '') +
      (q.prompt ? '<p class="quiz-prompt">' + esc(q.prompt).replace(/————/g, '<b>————</b>') + '</p>' : '');

    var body = q.typed
      ? '<div class="spell-form" style="margin-bottom:18px;">' +
          '<input type="text" id="qType" autocomplete="off" autocapitalize="off" autocorrect="off" ' +
            'spellcheck="false" placeholder="Type the word" aria-label="Type the word">' +
          '<button class="btn btn-primary" id="qGo">Check</button></div>' +
        '<div id="verdict"></div>'
      : '<div class="options" id="options">' + q.options.map(function (o, i) {
          return '<button class="option" data-opt="' + esc(o) + '">' +
            '<span class="num">' + (i + 1) + '</span><span>' + esc(o) + '</span></button>';
        }).join('') + '</div><div id="verdict"></div>';

    $('quizStage').innerHTML = head + body;
    quiz.answered = false;

    if (q.typed) {
      $('qGo').onclick = function () { answer($('qType').value); };
      $('qType').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); answer(this.value); } };
      $('qType').focus();
    } else {
      $('options').onclick = function (e) {
        var b = e.target.closest('.option');
        if (b) answer(b.getAttribute('data-opt'));
      };
    }
  }

  function answer(choice) {
    if (quiz.answered) return;
    var q = quiz.qs[quiz.i];
    if (q.typed && !String(choice).trim()) return;
    quiz.answered = true;

    var right = norm(choice) === norm(q.answer);
    if (right) quiz.score++; else quiz.missed.push(q.word);

    if (q.typed) {
      var inp = $('qType');
      inp.classList.add(right ? 'is-right' : 'is-wrong');
      inp.disabled = true;
      $('qGo').disabled = true;
    } else {
      Array.prototype.forEach.call(document.querySelectorAll('.option'), function (b) {
        var v = b.getAttribute('data-opt');
        b.disabled = true;
        if (v === q.answer) b.classList.add('is-right');
        else if (v === choice) b.classList.add('is-wrong');
      });
    }

    var w = q.word;
    var last = quiz.i === QUIZCFG.roundLength - 1;
    $('verdict').innerHTML =
      '<div class="verdict ' + (right ? 'right' : 'wrong') + '">' +
        '<p class="v-head">' + (right ? 'Correct' : 'Not this time') + '</p>' +
        '<p><b>' + esc(w.word) + '</b> \u2014 ' + esc(w.def) + '</p>' +
        (w.ex ? '<p style="font-style:italic;color:var(--muted);">' + highlight(w.ex, w.word) + '</p>' : '') +
      '</div>' +
      '<p><button class="btn btn-primary" id="nextQ">' + (last ? 'See your score' : 'Next question') + '</button></p>';

    $('nextQ').onclick = function () {
      quiz.i++;
      if (quiz.i >= QUIZCFG.roundLength) renderScore(); else renderQuestion();
    };
    $('nextQ').focus();
  }

  function renderScore() {
    var line = '';
    (QUIZCFG.verdicts || []).some(function (v) {
      if (quiz.score >= v.min) { line = v.text; return true; }
      return false;
    });

    var missed = quiz.missed.map(function (w) {
      return '<li><b>' + esc(w.word) + '</b> <span>' + esc(w.def) + '</span></li>';
    }).join('');

    $('quizStage').innerHTML =
      '<div class="score-hero"><div class="score-n">' + quiz.score + '/' + QUIZCFG.roundLength + '</div>' +
        '<p class="score-l">' + esc(line) + '</p></div>' +
      (missed ? '<h3 style="margin-top:26px;">Worth another look</h3><ul class="missed-list">' + missed + '</ul>' : '') +
      '<p style="margin-top:24px;text-align:center;">' +
        '<button class="btn btn-primary" id="again">Another ' + QUIZCFG.roundLength + '</button> ' +
        '<button class="btn" id="newRound">Change the word pool</button></p>';

    $('again').onclick = function () { startQuiz(quiz.pool); };
    $('newRound').onclick = quizIntro;
  }

  document.addEventListener('keydown', function (e) {
    if (tab !== 'quiz' || !quiz || quiz.answered) return;
    if (document.activeElement && document.activeElement.id === 'qType') return;
    if (new RegExp('^[1-' + QUIZCFG.optionCount + ']$').test(e.key)) {
      var b = document.querySelectorAll('.option')[+e.key - 1];
      if (b) answer(b.getAttribute('data-opt'));
    }
  });

  /* ====================================================================
     TABS
     ==================================================================== */
  var TABS = ['home', 'ielts', 'gre', 'pairs', 'quiz'];

  function switchTab(t) {
    tab = t;
    shown = PAGE;
    TABS.forEach(function (k) {
      $('tab-' + k).setAttribute('aria-selected', String(k === t));
    });

    // IELTS, GRE and Synonyms all render into the one browse area; only the
    // renderer and the exam filter differ between them.
    var browsing = (t === 'ielts' || t === 'gre' || t === 'pairs');
    $('panel-home').hidden = (t !== 'home');
    $('panel-quiz').hidden = (t !== 'quiz');
    $('browseTools').classList.toggle('is-hidden', !browsing);
    $('pairTools').classList.toggle('is-hidden', t !== 'pairs');
    $('grid').classList.toggle('is-hidden', t === 'pairs');
    $('pairs').classList.toggle('is-hidden', t !== 'pairs');

    if (browsing) load();
    if (t === 'quiz') quizIntro();
    if (t === 'home') updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  TABS.forEach(function (k) {
    $('tab-' + k).addEventListener('click', function () { switchTab(k); });
  });
  // Delegated, because some [data-go] buttons are rendered after load
  // (the "try the other list" link in an empty search result, for one).
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-go]');
    if (!el) return;
    e.preventDefault();
    switchTab(el.getAttribute('data-go'));
    document.body.classList.remove('nav-open');
  });

  /* --- site chrome ---------------------------------------------------- */
  $('navBurger').addEventListener('click', function () {
    var open = document.body.classList.toggle('nav-open');
    this.setAttribute('aria-expanded', String(open));
  });
  $('resetProgress').addEventListener('click', function () {
    save = { known: {}, spelled: {} };
    persist(); updateProgress();
    if (tab === 'pairs') renderPairs(); else if (tab !== 'home' && tab !== 'quiz') renderGrid();
  });
  $('yr').textContent = new Date().getFullYear();
})();
