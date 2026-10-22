// 妹はネコ 画面側（描画・入力・保存・ミニゲーム）。ゲームの中身は engine.js。
(function () {
  'use strict';

  const DATA = window.GAME_DATA;
  const E = new window.Engine(DATA);
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'imouto-neko-v1';
  const SETTINGS_KEY = 'imouto-neko-settings';
  const ENDINGS_KEY = 'imouto-neko-endings';
  // 台本の「!エンド 名前」を集めた一覧（登場順）
  const ENDINGS = (() => {
    const names = [];
    const walk = items => items.forEach(it => {
      if (it.type === 'cmd' && it.name === 'エンド' && !names.includes(it.args)) names.push(it.args);
      if (it.type === 'minigame') Object.values(it.branches).forEach(walk);
    });
    DATA.chapters.forEach(ch => ch.blocks.forEach(b => walk(b.items)));
    return names;
  })();
  // costume: old = VOICEROID 衣装（基準。中文版も同じ）, new = A.I.VOICE2 衣装, en = English 版衣装
  const settings = { size: 'm', costume: 'old' };
  const COSTUME_LABEL = { old: '衣装: 旧（VOICEROID）', new: '衣装: 新（A.I.VOICE2）', en: '衣装: English' };
  const COSTUME_NEXT = { old: 'new', new: 'en', en: 'old' };
  // 台本の「!衣装 …」と設定の値を、素材 id の接尾辞に直す
  const COSTUME_SUFFIX = { old: '', new: '_v2', en: '_en', 旧: '', 新: '_v2', English: '_en', 英: '_en', 中文: '' };
  const params = new URLSearchParams(location.search);
  const SKIP = params.get('skip') === '1';   // 確認用: 台詞を自動で送る
  const AUTO = (params.get('play') || '').split(',').filter(Boolean);   // 確認用: コマンドを順に自動実行

  let mode = 'title';   // title | dialog | commands | minigame | end
  let lastCmdAt = 0;
  let fadeAlpha = 0;
  let game = null;      // 実行中のミニゲーム（キー入力の受け口）

  const ui = {};
  ['title', 'play', 'stage', 'stage-wrap', 'objective', 'dialog', 'd-name', 'd-text', 'd-next', 'commands', 'minigame',
    'menu', 'menu-panel', 'chapter-end', 'ce-title', 'ce-text', 'btn-next', 'toast', 'btn-new', 'btn-continue', 'btn-size', 'btn-costume',
    'card', 'card-small', 'card-label', 'card-big']
    .forEach(id => { ui[id] = $(id); });

  // ---------- 保存（失敗しても遊べる） ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } },
  };
  function saveProgress() { store.set(SAVE_KEY, { snap: E.snapshot() }); }
  function saveFreshChapter(i) {
    const s = E.snapshot();
    store.set(SAVE_KEY, { snap: { v: 1, chapterIndex: i, fresh: true, found: s.found, special: s.special, runFound: s.runFound, runSpecial: s.runSpecial, runCleared: s.runCleared, hints: s.hints, runAt: s.runAt } });
  }
  function seenEndings() { const a = store.get(ENDINGS_KEY); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  function rememberEnding(name) { const a = seenEndings(); if (name && !a.includes(name)) { a.push(name); store.set(ENDINGS_KEY, a); } }
  function loadProgress() {
    const d = store.get(SAVE_KEY);
    if (!d || !d.snap || d.snap.v !== 1 || !Number.isInteger(d.snap.chapterIndex)) return null;
    if (!DATA.chapters[d.snap.chapterIndex]) return null;
    if (!d.snap.fresh && (typeof d.snap.state !== 'object' || !d.snap.state)) return null;
    return d.snap;
  }
  function loadSettings() {
    const s = store.get(SETTINGS_KEY);
    if (s && ['s', 'm', 'l'].includes(s.size)) settings.size = s.size;
    if (s && COSTUME_LABEL[s.costume]) settings.costume = s.costume;
  }
  function applySize() {
    document.body.className = 'size-' + settings.size;
    ui['btn-size'].textContent = '文字の大きさ: ' + { s: '小', m: '中', l: '大' }[settings.size];
    ui['btn-costume'].textContent = COSTUME_LABEL[settings.costume];
  }
  function cycleSize() { settings.size = { s: 'm', m: 'l', l: 's' }[settings.size]; applySize(); store.set(SETTINGS_KEY, settings); fitCanvas(); }
  function cycleCostume() { settings.costume = COSTUME_NEXT[settings.costume]; applySize(); store.set(SETTINGS_KEY, settings); render(); }
  // 人間の素材は衣装で id を切り替える。台本が「!衣装」で指定していればそれを優先し、なければ設定の衣装
  function humanSprite(base) {
    let c = (E.visual && E.visual.costume) || settings.costume;
    if (c === 'べつ') c = COSTUME_NEXT[settings.costume];   // 「昨日と違う服」= 設定の次の衣装
    const suffix = COSTUME_SUFFIX[c];
    return suffix !== undefined && sprites[base + suffix] ? base + suffix : base;
  }

  // ---------- 画面の切り替え ----------
  function showScreen(name) { ['title', 'play', 'chapter-end'].forEach(n => ui[n].classList.toggle('hidden', n !== name)); }
  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => ui.toast.classList.add('hidden'), 2800);
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  // 画面全体のカード（章と目標の提示）。約2秒で自動的に閉じる。タップで早送り
  function showCard(small, label, big, done) {
    const card = ui.card;
    ui['card-small'].textContent = small;
    ui['card-label'].textContent = label;
    ui['card-big'].textContent = big;
    card.classList.remove('hidden');
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(t); card.classList.add('hidden'); card.onclick = null; done(); };
    const t = setTimeout(finish, 2200);
    card.onclick = finish;
  }
  function button(label, fn, cls) { const b = el('button', cls, label); b.onclick = fn; return b; }

  function initTitle() {
    mode = 'title'; game = null;
    ui['btn-continue'].classList.toggle('hidden', !loadProgress());
    showScreen('title');
  }

  function startChapter(i) {
    E.startChapter(i);
    // 終章: 条件を満たしたエンディングが複数あれば、どれにするか選んでもらう
    const cands = E.chapter.candidates && E.chapter.candidates.length ? E.candidates() : [];
    if (cands.length > 1) { showEndingPicker(cands, name => { E.state.えらんだ = name; enterPlay(); step(); }); return; }
    enterPlay();
    step();
  }
  function showEndingPicker(cands, done) {
    const p = ui['menu-panel'];
    const seen = seenEndings();
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, '今日の終わり方'));
    frag.appendChild(el('p', 'note', '今日の過ごし方で、いくつかの終わり方が開きました。どれにしますか'));
    cands.forEach(n => frag.appendChild(button(seen.includes(n) ? `${n}（見た）` : `${n}　★まだ`, () => { closeMenu(); done(n); })));
    p.replaceChildren(frag);
    showScreen('play');
    ui.menu.classList.remove('hidden');
  }
  function enterPlay() {
    showScreen('play');
    ui.minigame.classList.add('hidden');
    ui.commands.replaceChildren();
    setDialog('', '', 'nare', false);
    fitCanvas();
    render();
  }

  // ---------- 進行 ----------
  function step(input) {
    let ev;
    try { ev = E.next(input); } catch (e) { console.error(e); toast('エラー: ' + e.message); return; }
    handle(ev);
  }
  function handle(ev) {
    ui.objective.textContent = E.visual.objective || '';
    switch (ev.type) {
      case 'say':
        if (fadeAlpha) fadeAlpha = 0;
        mode = 'dialog';
        showSay(ev);
        ui.commands.classList.add('hidden');
        render();
        if (SKIP) setTimeout(step, 0);
        break;
      case 'minigame':
        mode = 'minigame';
        render();
        startMinigame(ev);
        break;
      case 'fade':
        fadeAlpha = 1; render();
        setTimeout(step, SKIP ? 0 : 450);
        break;
      case 'end':
        render();
        onActionEnd(ev);
        break;
      case 'objective':   // 「1章 あさ／もくひょう: …」のカードを約2秒見せてから進む
        render();
        showCard(E.chapter.title, 'もくひょう', ev.text, step);
        break;
      default: // scene
        render();
        step();
    }
  }
  function onActionEnd(ev) {
    if (ev.fresh.length) toast(ev.fresh.map(d => (d.special ? '★ とくべつなはっけん: ' : 'はっけん: ') + d.name).join('\n'));
    if (ev.cleared) {
      const next = E.chapterIndex + 1;
      saveFreshChapter(DATA.chapters[next] ? next : 0);   // 最後まで行ったら、はっけんを持ったまま1章から
      showChapterEnd();
      return;
    }
    saveProgress();
    mode = 'commands';
    ui['d-next'].classList.add('hidden');
    renderCommands();
    if (AUTO.length) setTimeout(() => doCommand(AUTO.shift()), 0);
  }
  function advance() {
    if (mode !== 'dialog') return;
    if (Date.now() - lastCmdAt < 250) return;
    step();
  }
  function doCommand(key) {
    if (mode !== 'commands') return;
    let ok;
    try { ok = E.begin(key); } catch (e) { toast('エラー: ' + e.message); return; }
    if (!ok) { toast('いまは、それはできません'); return; }
    lastCmdAt = Date.now();
    step();
  }

  function showChapterEnd() {
    const hasNext = !!DATA.chapters[E.chapterIndex + 1];
    if (hasNext) {
      const c = E.counts();
      ui['ce-title'].textContent = E.chapter.title + '　クリア';
      ui['ce-text'].textContent = `はっけん ${c.found} / ${c.total}　　とくべつ ${c.special} / ${c.specialTotal}`;
      ui['btn-next'].textContent = 'つぎの章へ';
      ui['btn-next'].onclick = () => startChapter(E.chapterIndex + 1);
    } else {
      rememberEnding(E.ending);
      const t = totals(), seen = seenEndings();
      ui['ce-title'].textContent = E.ending ? `エンディング『${E.ending}』` : 'おしまい';
      ui['ce-text'].textContent = `エンディング ${seen.length} / ${ENDINGS.length}　　はっけん ${t.found} / ${t.total}　　とくべつ ${t.special} / ${t.specialTotal}` +
        '\n\n終わり方は、一日の過ごし方で変わります。メニューの「エンディング」で見たものを確認できます' +
        '\n\n（試作版。音声はこれから）';
      ui['btn-next'].textContent = 'タイトルへ';
      ui['btn-next'].onclick = initTitle;
    }
    showScreen('chapter-end');
    mode = 'end';
  }
  function totals() {
    const all = DATA.chapters.flatMap(ch => ch.blocks.flatMap(b => b.discoveries));
    return { found: Object.keys(E.found).length, total: all.filter(d => !d.special).length, special: Object.keys(E.special).length, specialTotal: all.filter(d => d.special).length };
  }

  // ---------- 会話 ----------
  function setDialog(name, text, cls, next) {
    ui['d-name'].textContent = name;
    ui['d-text'].textContent = text;
    ui.dialog.className = 'dialog ' + cls;
    ui['d-next'].classList.toggle('hidden', !next);
  }
  function showSay(it) {
    const sp = it.speaker;
    let name = '', cls = 'nare';
    if (sp === '茜') { name = '茜'; cls = 'akane'; }
    else if (sp === '葵') { name = '葵'; cls = 'aoi'; }
    else if (sp === 'こころ') { name = '葵（こころのこえ）'; cls = 'kokoro'; }
    else if (sp === '茜こころ') { name = '茜（こころのこえ）'; cls = 'akokoro'; }
    // 表情・演技は顔グラができるまで仮に名前へ添える
    if (it.tag && sp !== 'ナレ') name += `（${it.tag}）`;
    setDialog(name, it.text, cls, true);
  }

  // ---------- コマンド ----------
  function renderCommands(group) {
    const frag = document.createDocumentFragment();
    if (group) {
      group.targets.forEach(t => frag.appendChild(button(t, () => doCommand(`${group.base}→${t}`))));
      frag.appendChild(button('もどる', () => renderCommands(), 'wide'));
    } else {
      E.commands().forEach(c => frag.appendChild(button(c.targets.length ? c.base + ' →' : c.base, () => c.targets.length ? renderCommands(c) : doCommand(c.base))));
      frag.appendChild(button('メニュー', openMenu, 'wide'));
    }
    ui.commands.replaceChildren(frag);
    ui.commands.classList.remove('hidden');
  }

  // ---------- メニュー ----------
  function openMenu() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'メニュー'));
    if (E.hasHint()) frag.appendChild(button('ヒント', () => { closeMenu(); doCommand('ヒント'); }));
    frag.appendChild(button('はっけん', showFound));
    frag.appendChild(button('エンディング', showEndings));
    frag.appendChild(button('章をえらぶ', showChapters));
    frag.appendChild(button(ui['btn-size'].textContent, function () { cycleSize(); this.textContent = ui['btn-size'].textContent; }));
    frag.appendChild(button(ui['btn-costume'].textContent, function () { cycleCostume(); this.textContent = ui['btn-costume'].textContent; }));
    frag.appendChild(button('タイトルへ', () => { closeMenu(); initTitle(); }));
    frag.appendChild(button('とじる', closeMenu));
    p.replaceChildren(frag);
    ui.menu.classList.remove('hidden');
  }
  function closeMenu() { ui.menu.classList.add('hidden'); }
  function showFound() {
    const p = ui['menu-panel'];
    const c = E.counts();
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, `はっけん ${c.found} / ${c.total}　とくべつ ${c.special} / ${c.specialTotal}`));
    const ul = el('ul');
    E.discoveryList().forEach(d => {
      const li = el('li', d.name ? (d.special ? 'special' : '') : 'todo', d.name ? (d.special ? '★ ' : '') + d.name : '？？？');
      ul.appendChild(li);
    });
    frag.appendChild(ul);
    frag.appendChild(button('もどる', openMenu));
    p.replaceChildren(frag);
  }
  function showEndings() {
    const p = ui['menu-panel'];
    const seen = seenEndings();
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, `エンディング ${seen.length} / ${ENDINGS.length}`));
    const ul = el('ul');
    ENDINGS.forEach(n => ul.appendChild(el('li', seen.includes(n) ? '' : 'todo', seen.includes(n) ? n : '？？？')));
    frag.appendChild(ul);
    frag.appendChild(el('p', 'note', '一日の過ごし方（よく食べた、よく甘えた、など）で変わります。条件を満たした終わり方が複数あれば、終章の前に選べます'));
    frag.appendChild(button('もどる', openMenu));
    p.replaceChildren(frag);
  }
  function showChapters() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, '章をえらぶ（はっけんは残ります）'));
    DATA.chapters.forEach((ch, i) => frag.appendChild(button(ch.title, () => { closeMenu(); startChapter(i); })));
    frag.appendChild(button('もどる', openMenu));
    p.replaceChildren(frag);
  }

  // ---------- 描画 ----------
  const cv = ui.stage, cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  const FLOOR_Y = 140;
  const C = {
    wallAsa: '#c8d8f0', wallYoru: '#303858', wallHiru: '#f0e8c8', wallYuu: '#f0c090', floor: '#a07048', floorDark: '#805030', base: '#6a4020',
    wood: '#8c5a2c', woodTop: '#b07a48', woodDark: '#5c3a18', sofa: '#d84860', sofaDark: '#a83048',
    white: '#f8f8f8', gray: '#a0a0a8', black: '#1b1b2f', window: '#a8d8f8', windowNight: '#182040',
    fridge: '#e8e8f0', fridgeDark: '#c0c0c8', screen: '#203040', screenText: '#d0f0ff', yellow: '#f8e070', brown: '#805030',
    blue: '#78b0e0', pink: '#f48ab4', cabinet: '#d8c8a8', counter: '#c8c8d0',
  };
  const LAYOUTS = {
    room: {
      茜: { つくえ: [36, 116], ソファ: [204, 140], ゆか: [140, 140], たち: [140, 140] },
      葵: { ゆか: [120, 140], つくえ: [78, 104], ソファ: [172, 132] },
      葵人間: { ゆか: [168, 140], ソファ: [172, 140] },
      defaults: ['マグ', 'ノートPC', 'ペンたて', 'ほん'],
      props: { マグ: [90, 104], ノートPC: [46, 104], ペンたて: [100, 104], ほん: [104, 104], けしごむ: [86, 104], スマホ: [86, 104], かつおぶし: [112, 140], みず: [122, 140] },
      floorDrop: { ペンたて: [114, 140], けしごむ: [118, 140], ほん: [120, 140], マグ: [116, 140], スマホ: [116, 140] },
      slots: [[72, 104], [26, 104], [60, 104]],
    },
    town: {
      茜: { たち: [128, 140], ベンチ: [180, 140], だっこ: [128, 140] },
      葵: { ゆか: [92, 140] },
      葵人間: {},
      defaults: [],
      props: {},
      floorDrop: {},
      slots: [[40, 140], [60, 140]],
    },
    kitchen: {
      茜: { テーブル: [136, 116] },
      葵: { ゆか: [64, 140], テーブル: [150, 104] },
      defaults: [],
      props: { プリン: [118, 104], スプーン: [132, 104], 小さいスプーン: [192, 104], スマホ: [168, 104], ネコごはん: [32, 140], ごはんの小皿: [40, 140], ねこじゃらし: [52, 140], 猫砂: [16, 140], みず: [50, 140] },
      floorDrop: { スプーン: [104, 140] },
      slots: [[106, 104], [112, 104], [180, 104]],
    },
  };
  const sprites = rasterize(DATA.art);
  function rasterize(art) {
    const out = {};
    for (const sp of Object.values(art.sprites)) {
      const c = document.createElement('canvas');
      c.width = sp.w; c.height = sp.h;
      const g = c.getContext('2d');
      sp.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = art.palette[row[x]];
          if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
        }
      });
      out[sp.id] = { img: c, anchor: sp.anchor };
    }
    return out;
  }
  const rect = (x, y, w, h, col) => { cx.fillStyle = col; cx.fillRect(x, y, w, h); };
  function drawSprite(id, x, y) { const s = sprites[id]; if (s) cx.drawImage(s.img, Math.round(x - s.anchor[0]), Math.round(y - s.anchor[1])); }

  // PC 画面の小さい字（3x5）
  const GLYPH = {
    a: ['...', '.##', '#.#', '#.#', '.##'], o: ['...', '.#.', '#.#', '#.#', '.#.'], i: ['.#.', '...', '.#.', '.#.', '.#.'],
    e: ['.#.', '#.#', '###', '#..', '.##'], u: ['...', '#.#', '#.#', '#.#', '.##'], n: ['...', '##.', '#.#', '#.#', '#.#'],
    s: ['.##', '#..', '.#.', '..#', '##.'], t: ['.#.', '###', '.#.', '.#.', '..#'], k: ['#..', '#.#', '##.', '#.#', '#.#'],
    _: ['###', '#.#', '###', '#.#', '###'],
  };
  const LETTERS = 'aoiuenstkaoi';
  function drawPcText(x, y) {
    const text = E.visual.pc;
    if (!text) { // 原稿の三行
      rect(x, y + 1, 12, 1, C.screenText); rect(x, y + 4, 10, 1, C.screenText); rect(x, y + 7, 6, 1, C.screenText);
      return;
    }
    const chars = text.slice(-8).split('');
    chars.forEach((ch, i) => {
      const g = GLYPH[ch] || GLYPH._;
      const gx = x + (i % 4) * 4, gy = y + Math.floor(i / 4) * 6;
      g.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === '#') rect(gx + rx, gy + ry, 1, 1, C.screenText); });
    });
  }
  function drawHeart(x, y) {
    rect(x - 2, y - 4, 2, 2, C.pink); rect(x + 1, y - 4, 2, 2, C.pink); rect(x - 3, y - 2, 7, 2, C.pink);
    rect(x - 2, y, 5, 1, C.pink); rect(x - 1, y + 1, 3, 1, C.pink); rect(x, y + 2, 1, 1, C.pink);
  }
  const PROP = {
    'マグ': (x, y) => { rect(x, y - 6, 6, 6, C.white); rect(x + 6, y - 5, 2, 3, C.white); rect(x + 1, y - 4, 4, 1, C.pink); if (E.state.おちゃ === 'あたたかい') { rect(x + 2, y - 9, 1, 2, C.gray); rect(x + 4, y - 10, 1, 2, C.gray); } },
    'ノートPC': (x, y) => { rect(x, y - 2, 24, 2, C.gray); rect(x + 2, y - 17, 20, 15, C.black); rect(x + 3, y - 16, 18, 13, C.screen); drawPcText(x + 5, y - 15); },
    'ペンたて': (x, y) => { rect(x, y - 6, 4, 6, C.gray); rect(x + 1, y - 9, 1, 3, C.pink); rect(x + 2, y - 8, 1, 2, C.blue); },
    'ほん': (x, y) => { rect(x, y - 2, 8, 2, C.sofa); rect(x + 1, y - 4, 8, 2, '#3868a8'); rect(x, y - 6, 7, 2, C.yellow); },
    'けしごむ': (x, y) => rect(x, y - 2, 3, 2, C.white),
    'かつおぶし': (x, y) => { rect(x, y - 2, 10, 2, C.white); rect(x + 2, y - 4, 6, 2, '#c08050'); },
    'みず': (x, y) => { rect(x, y - 2, 8, 2, C.white); rect(x + 1, y - 3, 6, 1, C.blue); },
    'プリン': (x, y) => {
      rect(x + 1, y - 6, 6, 2, C.brown); rect(x, y - 4, 8, 4, C.yellow); rect(x - 1, y - 1, 10, 1, C.white);
      const a = (E.visual.pudding ?? 180) * Math.PI / 180;
      rect(x + 4 + Math.round(Math.sin(a) * 3), y - 3 - Math.round(Math.cos(a) * 2), 1, 1, C.white);
    },
    'スプーン': (x, y) => { rect(x, y - 1, 8, 1, C.gray); rect(x + 6, y - 2, 3, 2, C.gray); },
    '小さいスプーン': (x, y) => { rect(x, y - 1, 5, 1, C.gray); rect(x, y - 3, 5, 1, C.gray); },
    'スマホ': (x, y) => { rect(x, y - 7, 4, 7, C.black); rect(x + 1, y - 6, 2, 5, '#4060a0'); },
    'ネコごはん': (x, y) => { rect(x, y - 6, 6, 6, '#a06030'); rect(x + 1, y - 5, 4, 2, C.white); },
    'ごはんの小皿': (x, y) => { rect(x, y - 2, 8, 2, C.white); rect(x + 2, y - 3, 4, 1, '#a06030'); },
    'ねこじゃらし': (x, y) => { rect(x + 3, y - 8, 1, 8, '#c0a060'); rect(x + 1, y - 11, 5, 3, C.white); },
    '猫砂': (x, y) => { rect(x, y - 8, 10, 8, '#c8c8c8'); rect(x + 2, y - 6, 6, 3, '#4060a0'); },
  };
  function drawProps(L) {
    const v = E.visual;
    const names = [...new Set([...L.defaults, ...Object.keys(v.props)])];
    let slot = 0;
    for (const n of names) {
      const draw = PROP[n] || ((x, y) => { rect(x, y - 6, 6, 6, C.gray); rect(x + 1, y - 5, 4, 4, C.black); });
      let pos;
      if (v.fallen[n]) pos = L.floorDrop[n] || [L.props[n] ? L.props[n][0] + 20 : 120 + slot * 10, FLOOR_Y];
      else pos = L.props[n] || L.slots[slot++ % L.slots.length];
      draw(pos[0], pos[1]);
    }
  }
  function drawRoomBack(time) {
    rect(0, 0, 256, 120, time === 'yoru' ? C.wallYoru : time === 'yuu' ? C.wallYuu : C.wallAsa);
    rect(176, 24, 56, 48, C.white); rect(178, 26, 52, 44, time === 'yoru' ? C.windowNight : time === 'yuu' ? '#f8a060' : C.window);
    rect(203, 26, 2, 44, C.white); rect(178, 47, 52, 2, C.white);
    if (time === 'yoru') { rect(186, 32, 1, 1, C.yellow); rect(218, 38, 1, 1, C.yellow); rect(196, 56, 1, 1, C.yellow); }
    rect(112, 40, 40, 56, C.woodDark); rect(114, 42, 36, 16, C.wood); rect(114, 60, 36, 16, C.wood); rect(114, 78, 36, 16, C.wood); // 本棚
    rect(116, 46, 6, 12, C.sofa); rect(123, 44, 5, 14, '#3868a8'); rect(129, 48, 8, 10, C.yellow); rect(138, 46, 4, 12, C.white);
    rect(116, 64, 10, 12, C.white); rect(127, 62, 6, 14, C.pink); rect(134, 66, 8, 10, '#3868a8');
    rect(176, 84, 20, 14, C.woodDark); rect(178, 86, 16, 10, C.window); rect(182, 90, 8, 4, C.pink); // 壁の写真
  }
  function drawRoomFront() {
    rect(24, 100, 88, 4, C.woodTop); rect(24, 104, 88, 36, C.wood); rect(28, 108, 36, 12, C.woodDark); rect(68, 108, 40, 12, C.woodDark);
    // ソファは低め。座った茜はこの上に描く（render 側）
    rect(160, 114, 80, 12, C.sofaDark); rect(160, 114, 80, 3, C.sofa);
    rect(160, 126, 80, 6, C.sofa); rect(160, 132, 80, 8, C.sofaDark);
    rect(154, 110, 6, 30, C.sofa); rect(240, 110, 6, 30, C.sofa);
  }
  function drawKitchenBack() {
    rect(0, 0, 256, 120, C.wallHiru);
    rect(8, 20, 88, 30, C.cabinet); rect(8, 20, 88, 2, C.woodDark); rect(51, 22, 2, 28, C.woodDark); rect(8, 48, 88, 2, C.woodDark);
    rect(120, 24, 56, 40, C.white); rect(122, 26, 52, 36, C.window); rect(147, 26, 2, 36, C.white);
    rect(208, 56, 32, 84, C.fridge); rect(208, 56, 32, 1, C.black); rect(208, 56, 1, 84, C.black); rect(239, 56, 1, 84, C.black);
    rect(208, 92, 32, 2, C.fridgeDark); rect(212, 70, 2, 14, C.gray); rect(212, 100, 2, 20, C.gray);
    rect(8, 100, 80, 4, C.white); rect(8, 104, 80, 36, C.counter); rect(30, 96, 2, 6, C.gray); rect(30, 94, 10, 2, C.gray);
  }
  function drawKitchenFront() {
    rect(100, 100, 100, 4, '#e8e0d0'); rect(100, 104, 100, 20, C.white); rect(100, 104, 100, 20, 'rgba(120,80,40,.35)');
    rect(104, 124, 4, 16, C.wood); rect(192, 124, 4, 16, C.wood);
  }
  // ── 町（3章）──
  const TOWN = new Set(['いえのまえ', 'こうえん', 'しょうてんがい', 'かわら', 'かえりみち']);
  function drawSky(night) {
    if (night) {
      rect(0, 0, 256, 120, '#182040');
      [[30, 20], [90, 36], [150, 14], [210, 30], [240, 60], [60, 70]].forEach(([x, y]) => rect(x, y, 1, 1, C.yellow));
    } else { rect(0, 0, 256, 40, '#6a3870'); rect(0, 40, 256, 40, '#d86048'); rect(0, 80, 256, 40, '#f8a060'); }
  }
  function drawTownBack(place, time) {
    const night = place === 'かえりみち' || time === 'yoru';
    drawSky(night);
    if (place === 'かわら') {
      rect(0, 96, 256, 4, '#808088'); rect(0, 100, 256, 20, '#5a8a40');            // 遠くの橋、向こう岸
      rect(0, 120, 256, 20, '#4a8a40'); rect(0, 140, 256, 20, '#3868a8');          // 土手と川
      for (let x = 8; x < 256; x += 40) rect(x, 148, 14, 1, '#78b0e0');
      rect(208, 86, 48, 8, '#704020'); rect(212, 94, 3, 46, '#704020'); rect(245, 94, 3, 46, '#704020');   // あずまや
      rect(156, 112, 48, 10, '#8c5a2c'); rect(158, 114, 44, 2, '#b07a48'); rect(158, 118, 44, 2, '#b07a48'); // ベンチの背
      return;
    }
    const park = place === 'こうえん';
    rect(0, 120, 256, 40, park ? '#4a8a40' : '#8a8a90');
    for (let x = 0; x < 256; x += 32) rect(x, 120, 1, 40, park ? '#3a7a30' : '#707078');
    if (place === 'いえのまえ' || place === 'かえりみち') {
      rect(8, 40, 88, 80, '#e8d8c0'); rect(0, 32, 104, 10, '#8a4030'); rect(40, 80, 20, 40, '#704020'); rect(56, 100, 2, 2, C.yellow);
      rect(16, 56, 20, 16, night ? C.yellow : C.window); rect(64, 56, 20, 16, night ? C.yellow : C.window);
      for (let x = 120; x < 256; x += 16) rect(x, 100, 4, 20, '#a08060');
      rect(120, 100, 136, 3, '#a08060');
    } else if (park) {
      [24, 200, 236].forEach(x => { rect(x + 10, 90, 6, 30, '#6a4020'); rect(x, 62, 26, 32, '#3a7a30'); rect(x + 4, 58, 18, 6, '#3a7a30'); });
      rect(140, 80, 2, 40, C.gray); rect(176, 80, 2, 40, C.gray); rect(140, 80, 38, 2, C.gray);
      rect(154, 82, 1, 30, C.gray); rect(163, 82, 1, 30, C.gray); rect(152, 112, 14, 2, '#704020');   // ブランコ
    } else if (place === 'しょうてんがい') {
      for (let i = 0; i < 4; i++) {
        const x = i * 64;
        rect(x, 44, 64, 76, i % 2 ? '#d8c8b0' : '#c8d0d8');
        for (let s = 0; s < 10; s++) rect(x + 2 + s * 6, 60, 6, 10, s % 2 ? C.white : (i % 2 ? C.sofa : '#3868a8'));
        rect(x + 10, 48, 44, 8, C.yellow); rect(x + 24, 88, 16, 32, '#504030');
      }
    }
  }
  function drawTownFront(place) {
    if (place === 'かわら') { rect(156, 124, 48, 4, '#b07a48'); rect(158, 128, 3, 12, '#704020'); rect(199, 128, 3, 12, '#704020'); }
  }
  function render() {
    if (game && game.draw) { game.draw(); return; }
    const v = E.visual;
    if (!v) return;
    const scene = v.scene || '';
    const place = scene.split('・')[0];
    const kind = scene.startsWith('キッチン') ? 'kitchen' : TOWN.has(place) ? 'town' : 'room';
    const time = scene.includes('よる') ? 'yoru' : scene.includes('ゆうがた') ? 'yuu' : scene.includes('ひる') ? 'hiru' : 'asa';
    const L = LAYOUTS[kind];
    if (kind === 'town') drawTownBack(place, time);
    else {
      rect(0, 0, 256, 160, C.floor);
      for (let x = 0; x < 256; x += 32) rect(x, 120, 1, 40, C.floorDark);
      if (kind === 'room') drawRoomBack(time); else drawKitchenBack();
      rect(0, 118, 256, 2, C.base);
    }
    const akaneCat = E.state.茜すがた === 'ネコ';
    const ap = L.茜[E.state.茜] || (akaneCat ? L.茜.ゆか : null);
    const seated = (kind === 'room' && E.state.茜 === 'ソファ') || (kind === 'town' && E.state.茜 === 'ベンチ');
    if (ap && !akaneCat && !seated) drawSprite(humanSprite('akane_stand'), ap[0], ap[1]);   // 机の後ろに立つ（座って見える）
    if (kind === 'room') drawRoomFront(); else if (kind === 'kitchen') drawKitchenFront(); else drawTownFront(place);
    if (ap && !akaneCat && seated) drawSprite(humanSprite('akane_sit'), ap[0], ap[1]);       // ソファやベンチの上に全身
    if (ap && akaneCat) drawSprite('cat_akane', ap[0], ap[1]);                                 // 隠しED: ネコの茜
    drawProps(L);
    const human = E.state.すがた === 'にんげん';
    let gp, sp;
    if (human) { gp = (L.葵人間 && L.葵人間[E.state.葵]) || [168, 140]; sp = humanSprite(E.state.葵 === 'ソファ' ? 'aoi_sit' : 'aoi_stand'); }
    else if (E.state.葵 === 'だっこ' && ap) { gp = [ap[0] + 6, ap[1] - 12]; sp = 'cat_sit'; }   // 茜の腕の中
    else { gp = L.葵[E.state.葵]; sp = v.pose.葵 === 'ねころぶ' ? 'cat_lie' : 'cat_sit'; }
    if (gp) drawSprite(sp, gp[0], gp[1]);
    if (v.pose.茜 === 'なでる' && gp) drawHeart(gp[0] + 10, gp[1] - 22);
    if (fadeAlpha > 0) rect(0, 0, 256, 160, `rgba(0,0,0,${fadeAlpha})`);
  }
  function fitCanvas() {
    const wrap = ui['stage-wrap'];
    if (!wrap.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(256, wrap.clientWidth - 4);
    const portrait = window.innerHeight > window.innerWidth;
    const maxH = window.innerHeight * (portrait ? 0.40 : 0.75);
    let phys = Math.max(1, Math.floor(availW * dpr / 256));       // 端末の実ピクセルで整数倍
    while (phys > 1 && phys * 160 / dpr > maxH) phys--;
    let cssW = Math.min(phys * 256 / dpr, availW, 768);
    // 整数倍だと幅の2割以上が余るときは、にじみより大きさを優先して幅いっぱいにする
    if (cssW < availW * 0.8 && availW * 160 / 256 <= maxH) cssW = Math.min(availW, 768);
    cv.style.width = cssW + 'px';
    cv.style.height = (cssW * 160 / 256) + 'px';
  }

  // ---------- ミニゲーム ----------
  function startMinigame(ev) {
    ui.commands.classList.add('hidden');
    ui.minigame.classList.remove('hidden');
    ui['d-next'].classList.add('hidden');
    if (ev.name === 'キーボードれんだ') kbGame(ev.params);
    else if (ev.name === 'プリンまわし') puddingGame(ev.params);
    else if (ev.name === 'よみちさんぽ') walkGame(ev.params);
    else if (ev.name === 'エーオーアイ') aoiGame(ev.params);
    else { toast(`（ミニゲーム「${ev.name}」は未実装。成功あつかい）`); endGame('せいこう'); }
  }
  function endGame(result) {
    if (game && game.stop) game.stop();
    game = null;
    ui.minigame.classList.add('hidden');
    ui.minigame.replaceChildren();
    mode = 'dialog';
    render();
    step({ result });
  }
  // 3章: お姉ちゃんについて歩く。塀はジャンプで越え、カラスは跳ばずにやり過ごす。失敗はない
  function walkGame(p) {
    const total = (Number(p.長さ) || 8) * 1000;
    const seg = Number(p.区間) || 1;
    const carried = !!p.だっこ;   // 茜に抱かれて進む（障害物なし）
    const t0 = Date.now();
    let scroll = 0, jumpY = 0, vy = 0, stumbles = 0, stumbleUntil = 0, done = false, nextObs = 1200;
    const obs = [];
    const prog = el('div', 'prog', carried ? 'お姉ちゃんの腕の中' : '');
    const bar = el('div', 'bar'); const fill = document.createElement('div'); fill.style.width = '0%'; bar.appendChild(fill);
    const btn = el('button', 'big', carried ? 'ゆられる' : 'ジャンプ！');
    const row = el('div', 'row'); row.append(btn, button('スキップ', () => finish()));
    ui.minigame.replaceChildren(el('div', 'title', carried ? '抱っこで商店街へ。何もしなくていい' : seg === 1 ? 'お姉ちゃんについていこう。塀はジャンプで越える。カラスが来たら跳ばない' : 'お姉ちゃんについていこう'), prog, bar, row);
    const jump = () => { if (!done && !carried && jumpY === 0) vy = -5.2; };
    hold(btn, jump, () => {});
    function finish() { if (done) return; done = true; clearInterval(timer); setTimeout(() => endGame('せいこう'), 300); }
    const timer = setInterval(() => {
      const now = Date.now(), t = now - t0;
      const speed = now < stumbleUntil ? 1 : 2.4;
      scroll += speed;
      jumpY += vy; vy += 0.45; if (jumpY > 0) { jumpY = 0; vy = 0; }
      if (!carried && t > nextObs) { obs.push({ x: 270, kind: Math.random() < 0.6 ? '塀' : 'カラス' }); nextObs = t + 1400 + Math.random() * 1200; }
      for (const o of obs) {
        o.x -= speed;
        if (o.hit) continue;
        const wall = o.kind === '塀';
        const ox1 = o.x + (wall ? 12 : 10), oy0 = wall ? 130 : 102, oy1 = wall ? 140 : 110;
        if (ox1 > 74 && o.x < 86 && oy1 > 126 + jumpY && oy0 < 140 + jumpY) {
          o.hit = true; stumbles++; stumbleUntil = now + 700;
          prog.textContent = `つまずいた！ ${stumbles}回　茜「大丈夫かー？」`;
        }
      }
      while (obs.length && obs[0].x < -20) obs.shift();
      fill.style.width = Math.min(100, t / total * 100) + '%';
      render();
      if (t >= total) finish();
    }, 33);
    game = {
      stop: () => clearInterval(timer),
      key: e => { if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') jump(); },
      draw: () => {
        drawSky(false);
        rect(0, 120, 256, 40, seg === 2 ? '#4a8a40' : '#8a8a90');
        for (let x = -(scroll % 32); x < 256; x += 32) rect(x, 120, 1, 40, seg === 2 ? '#3a7a30' : '#707078');
        for (let x = -((scroll * 0.5) % 48); x < 256; x += 48) {
          if (seg === 1) rect(x, 100, 4, 20, '#a08060');
          else if (seg === 2) { rect(x + 10, 90, 6, 30, '#6a4020'); rect(x, 62, 26, 32, '#3a7a30'); }
          else { rect(x, 50, 40, 70, '#d8c8b0'); rect(x + 2, 64, 36, 8, C.sofa); }
        }
        for (const o of obs) {
          if (o.kind === '塀') { rect(o.x, 130, 12, 10, C.gray); rect(o.x, 130, 12, 2, '#c8c8d0'); }
          else { rect(o.x, 104, 10, 4, C.black); rect(o.x + 3, 102, 4, 2, C.black); rect(o.x + 9, 105, 2, 1, C.yellow); }
        }
        const bob = Math.floor(scroll / 8) % 2;
        drawSprite(humanSprite('akane_stand'), 176, 140 - bob);
        if (carried) drawSprite('cat_sit', 182, 128 - bob);
        else if (!(Date.now() < stumbleUntil && Math.floor(Date.now() / 80) % 2)) drawSprite('cat_sit', 80, 140 + jumpY);
      },
    };
  }
  // 4章: 画面内キーボードで a → o → i。にくきゅう は隣のキーも押してしまい必ず失敗、つめ は一文字ずつ
  function aoiGame(p) {
    const mode = p.モード || 'つめ', target = 'aoi';
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    let typed = '', done = false;
    const hint = el('div', 'prog', '');
    const kb = el('div', 'kb');
    const update = () => {
      E.visual.pc = typed; render();
      hint.textContent = mode === 'にくきゅう' ? 'エー（a）のキーを、肉球で' : (typed === target ? 'aoi' : `つぎ: ${target[typed.length] || ''}　（${typed || '　'}）`);
    };
    const finish = r => { if (done) return; done = true; setTimeout(() => endGame(r), 700); };
    const erase = () => { if (done || mode !== 'つめ') return; typed = typed.slice(0, -1); update(); };
    const press = ch => {
      if (done) return;
      if (mode === 'にくきゅう') {
        const row = rows.find(r => r.includes(ch)), i = row.indexOf(ch);
        const nb = [row[i - 1], row[i + 1]].filter(Boolean);
        typed = Math.random() < 0.5 ? (nb[0] || nb[1]) + ch : ch + (nb[1] || nb[0]);
        update(); finish('しっぱい'); return;
      }
      typed += ch; update();
      if (typed === target) finish('せいこう');
      else if (!target.startsWith(typed)) hint.textContent = `……ちがう。「けす」で消せます　（${typed}）`;
    };
    rows.forEach(r => { const line = el('div', 'kbrow'); for (const ch of r) line.appendChild(button(ch, () => press(ch), 'key')); kb.appendChild(line); });
    const ctl = el('div', 'row');
    if (mode === 'つめ') ctl.appendChild(button('けす', erase));
    ctl.appendChild(button('やめる', () => finish('しっぱい')));
    ui.minigame.replaceChildren(el('div', 'title', mode === 'にくきゅう' ? 'キーボードを、肉球で押す' : '爪で一本ずつ。a → o → i の順に押す'), hint, kb, ctl);
    update();
    game = { key: e => { const k = e.key.toLowerCase(); if (/^[a-z]$/.test(k)) press(k); else if (e.key === 'Backspace') erase(); } };
  }
  function hold(btn, down, up) {
    btn.onpointerdown = e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); down(); };
    btn.onpointerup = btn.onpointercancel = () => up();
  }
  function kbGame(p) {
    const target = Number(p.目標) || 15, limit = 5000;
    let count = 0, started = 0, timer = null, holdTimer = null, done = false;
    const prog = el('div', 'prog', `0 / ${target}`);
    const bar = el('div', 'bar'); const fill = document.createElement('div'); fill.style.width = '100%'; bar.appendChild(fill);
    const btn = el('button', 'big', 'ふむ！');
    ui.minigame.replaceChildren(el('div', 'title', 'キーボードをふめ！（連打でも長押しでも。PCはどのキーでも）'), prog, bar, btn);
    const finish = ok => {
      if (done) return;
      done = true; clearInterval(timer); clearInterval(holdTimer);
      setTimeout(() => endGame(ok ? 'せいこう' : 'しっぱい'), 500);
    };
    const tick = () => {
      const t = Date.now() - started;
      fill.style.width = Math.max(0, 100 - t / limit * 100) + '%';
      if (t >= limit) finish(count >= target);
    };
    const press = () => {
      if (done) return;
      if (!started) { started = Date.now(); timer = setInterval(tick, 50); }
      count++;
      E.visual.pc = (E.visual.pc + LETTERS[Math.floor(Math.random() * LETTERS.length)]).slice(-40);
      prog.textContent = `${count} / ${target}`;
      render();
      if (count >= target) finish(true);
    };
    hold(btn, () => { press(); clearInterval(holdTimer); holdTimer = setInterval(press, 110); }, () => clearInterval(holdTimer));
    game = { key: () => press() };
  }
  function puddingGame() {
    let angle = 180, dir = 0, done = false;
    E.visual.pudding = angle;
    const dial = document.createElement('canvas'); dial.width = 96; dial.height = 96; dial.className = 'dial';
    const g = dial.getContext('2d');
    const L = el('button', 'big', '◀ ひだり'), R = el('button', 'big', 'みぎ ▶');
    L.style.minWidth = R.style.minWidth = '120px';
    const row = el('div', 'row'); row.append(L, R);
    ui.minigame.replaceChildren(el('div', 'title', 'プリンをまわして、「あおい」をお姉ちゃんに向けよう（長押しで回る。PCは ← →）'), dial, row);
    const drawDial = () => {
      g.clearRect(0, 0, 96, 96);
      g.fillStyle = C.pink; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('↑ お姉ちゃん', 48, 0);
      g.fillStyle = C.yellow; g.beginPath(); g.arc(48, 52, 36, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.brown; g.lineWidth = 4; g.stroke();
      // 手前（ネコ側）にあるときは正しく読め、お姉ちゃん側へ回すと逆さまになる
      g.save(); g.translate(48, 52); g.rotate((angle - 180) * Math.PI / 180);
      g.fillStyle = C.black; g.font = 'bold 15px sans-serif'; g.textBaseline = 'middle'; g.fillText('あおい', 0, 20);
      g.restore();
    };
    const loop = setInterval(() => {
      if (!dir || done) return;
      angle = (angle + dir * 3 + 360) % 360;
      E.visual.pudding = angle;
      const n = angle > 180 ? angle - 360 : angle;
      if (Math.abs(n) <= 6) {
        done = true; dir = 0; angle = 0; E.visual.pudding = 0;
        clearInterval(loop);
        drawDial(); render();
        setTimeout(() => endGame('せいこう'), 600);
        return;
      }
      drawDial(); render();
    }, 30);
    // ◀ で手前の文字が左へ動く（手前の点が左へ = 時計回り = 角度が増える）
    hold(L, () => { dir = 1; }, () => { dir = 0; });
    hold(R, () => { dir = -1; }, () => { dir = 0; });
    game = {
      key: e => { if (e.key === 'ArrowLeft') dir = 1; else if (e.key === 'ArrowRight') dir = -1; },
      keyup: e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') dir = 0; },
    };
    drawDial();
  }

  // ---------- 入力 ----------
  ui.dialog.addEventListener('click', advance);
  ui.stage.addEventListener('click', advance);
  document.addEventListener('keydown', e => {
    if (!ui.menu.classList.contains('hidden')) { if (e.key === 'Escape') closeMenu(); return; }
    if (game && game.key) { game.key(e); e.preventDefault(); return; }
    if (mode === 'dialog' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); }
    else if (mode === 'commands' && /^[1-9]$/.test(e.key)) { const b = ui.commands.querySelectorAll('button')[Number(e.key) - 1]; if (b) b.click(); }
    else if (mode === 'commands' && e.key === 'Escape') openMenu();
  });
  document.addEventListener('keyup', e => { if (game && game.keyup) game.keyup(e); });
  window.addEventListener('resize', fitCanvas);
  ui.menu.addEventListener('click', e => { if (e.target === ui.menu) closeMenu(); });

  ui['btn-new'].onclick = () => startChapter(0);   // 周回の記録は空になる。はっけんのコレクションは残る
  ui['btn-continue'].onclick = () => {
    const snap = loadProgress();
    if (!snap) { toast('セーブデータがありません'); initTitle(); return; }
    if (snap.fresh) {
      E.restoreRun(snap);
      startChapter(snap.chapterIndex);
      return;
    }
    if (!E.restore(snap)) { toast('セーブデータを読めませんでした'); return; }
    enterPlay();
    mode = 'commands';
    setDialog('', 'つづきから。', 'nare', false);
    ui.objective.textContent = E.visual.objective || '';
    renderCommands();
    render();
  };
  ui['btn-size'].onclick = cycleSize;
  ui['btn-costume'].onclick = cycleCostume;

  // ---------- 起動 ----------
  loadSettings();
  applySize();
  if (params.get('debug') === '1') {     // 確認用: 画面の大きさを表示
    document.querySelector('.note').textContent = `画面 ${window.innerWidth}×${window.innerHeight} / 倍率 ${window.devicePixelRatio}`;
  }
  // 確認用: ?special=4 で とくべつ4つ、?tags=くいしんぼ,ねぼすけ でその性格の反応を全部見つけたことにする（周回の記録に入れる）
  if (params.get('special') === '4') for (let i = 0; i < 4; i++) E.runSpecial['debug.' + i] = 'x';
  (params.get('tags') || '').split(',').filter(Boolean).forEach(tag => {
    DATA.chapters.forEach((ch, ci) => ch.blocks.forEach(b => b.discoveries.forEach(d => { if ((d.tags || []).includes(tag)) E.runFound[`c${ci + 1}.${d.id}`] = d.name; })));
  });
  const startAt = params.get('start');   // 確認用: ?start=0 で1章から直接
  if (startAt !== null && DATA.chapters[Number(startAt)]) startChapter(Number(startAt));
  else initTitle();
})();
