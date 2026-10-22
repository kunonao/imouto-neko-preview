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
  // costume: old = 中文版の衣装（基準。aivoice.jp のキャラクターページの立ち絵）, new = A.I.VOICE2 衣装, en = English 版衣装
  const settings = { size: 'm', costume: 'old', font: 'dot' };   // font: dot = DotGothic16 / pixel = PixelMplus12（ファミコン風）/ std = 端末の書体
  const FONT_LABEL = { dot: '文字: ドット', pixel: '文字: ファミコン風', std: '文字: 標準' };
  const FONT_NEXT = { dot: 'pixel', pixel: 'std', std: 'dot' };
  const COSTUME_LABEL = { old: '衣装: 中文版', new: '衣装: A.I.VOICE2', en: '衣装: English' };
  const COSTUME_NEXT = { old: 'new', new: 'en', en: 'old' };
  // 台本の「!衣装 …」と設定の値を、素材 id の接尾辞に直す
  const COSTUME_SUFFIX = { old: '', new: '_v2', en: '_en', 中文: '', 中文版: '', 旧: '', 新: '_v2', English: '_en', 英: '_en' };
  const params = new URLSearchParams(location.search);
  const SKIP = params.get('skip') === '1';   // 確認用: 台詞を自動で送る
  const AUTO = (params.get('play') || '').split(',').filter(Boolean);   // 確認用: コマンドを順に自動実行
  const STOP = params.get('stop') || '';   // 確認用: skip=1 のとき、この文字を含む台詞で自動送りを止める（途中の絵を見る）
  const GAME_SKIP = params.get('game') === 'skip';   // 確認用: ミニゲームを成功あつかいで飛ばす

  let mode = 'title';   // title | dialog | commands | minigame | end
  let lastCmdAt = 0;
  let fadeAlpha = 0;
  let game = null;      // 実行中のミニゲーム（キー入力の受け口）

  const ui = {};
  ['app', 'title', 'play', 'stage', 'stage-wrap', 'objective', 'dialog', 'd-name', 'd-text', 'd-next', 'commands', 'minigame', 'panel', 'btn-menu',
    'menu', 'menu-panel', 'chapter-end', 'ce-title', 'ce-text', 'btn-next', 'toast', 'btn-new', 'btn-continue', 'btn-size', 'btn-font', 'btn-costume', 'btn-credits',
    'card', 'card-small', 'card-label', 'card-big', 'disc', 'btn-found']
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
    if (s && FONT_LABEL[s.font]) settings.font = s.font;
    if (FONT_LABEL[params.get('font')]) settings.font = params.get('font');   // 確認用: ?font=dot|pixel|std
  }
  function applySize() {
    document.body.className = 'size-' + settings.size + (settings.font === 'dot' ? '' : ' font-' + settings.font);
    ui['btn-size'].textContent = '文字の大きさ: ' + { s: '小', m: '中', l: '大' }[settings.size];
    ui['btn-font'].textContent = FONT_LABEL[settings.font];
    ui['btn-costume'].textContent = COSTUME_LABEL[settings.costume];
  }
  function cycleSize() { settings.size = { s: 'm', m: 'l', l: 's' }[settings.size]; applySize(); store.set(SETTINGS_KEY, settings); fitCanvas(); }
  function cycleFont() { settings.font = FONT_NEXT[settings.font]; applySize(); store.set(SETTINGS_KEY, settings); }
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
  // 場面の左上の札（はっけん・目標の変更）
  function showBanner(lines, cls) {
    ui.disc.className = cls || '';
    ui.disc.replaceChildren(...[].concat(lines).map(l => (typeof l === 'string' ? el('div', '', l) : l)));
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(() => ui.disc.classList.add('hidden'), 3600);
  }
  // はっけんは画面の上（場面の左上の札）に出す。上の帯の「はっけん n/m」も光らせる
  function showDisc(list) {
    showBanner(list.map(d => el('div', d.special ? 'special' : '', (d.special ? '★ とくべつなはっけん　' : 'はっけん　') + d.name)));
    ui['btn-found'].classList.remove('flash');
    void ui['btn-found'].offsetWidth;   // 連続でも毎回光るように、アニメを仕切り直す
    ui['btn-found'].classList.add('flash');
  }
  function updateFound() {
    if (!E.chapter) return;
    const c = E.counts();
    ui['btn-found'].textContent = `はっけん ${c.found}/${c.total}` + (c.specialTotal ? ` ★${c.special}/${c.specialTotal}` : '');
  }
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
    ui.play.classList.remove('game');
    ui.disc.classList.add('hidden');
    ui.commands.replaceChildren();
    setDialog('', '', 'nare', false);
    updateFound();
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
        ui.commands.classList.add('busy');   // 枠は残したまま薄くする
        render();
        if (SKIP && !(STOP && ev.text.includes(STOP))) setTimeout(step, 0);
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
      case 'objective':   // 章の最初は「1章 あさ／もくひょう: …」のカードを約2秒。途中の変更は場面の札で知らせるだけ
        render();
        if (ev.first !== false) showCard(E.chapter.title, 'もくひょう', ev.text, step);
        else { showBanner('もくひょう　' + ev.text, 'goal'); step(); }
        break;
      default: // scene
        render();
        step();
    }
  }
  function onActionEnd(ev) {
    if (ev.fresh.length) { showDisc(ev.fresh); updateFound(); }
    if (ev.cleared && params.get('hold') === '1') { mode = 'commands'; return; }   // 確認用: クリア画面に進まず最後の場面で止まる
    if (ev.cleared) {
      const next = E.chapterIndex + 1;
      saveFreshChapter(DATA.chapters[next] ? next : 0);   // 最後まで行ったら、はっけんを持ったまま1章から
      showChapterEnd();
      return;
    }
    saveProgress();
    mode = 'commands';
    ui['d-next'].classList.add('hidden');
    cmdPage = 0;
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
    const all = DATA.chapters.flatMap((ch, ci) => { const ids = new Set(); return ch.blocks.flatMap(b => b.discoveries).filter(d => !ids.has(d.id) && ids.add(d.id)); });
    return { found: Object.keys(E.found).length, total: all.filter(d => !d.special).length, special: Object.keys(E.special).length, specialTotal: all.filter(d => d.special).length };
  }

  // ---------- 会話 ----------
  function setDialog(name, text, cls, next) {
    ui['d-name'].textContent = name;
    ui['d-text'].textContent = text;
    ui.dialog.className = 'dialog frame ' + cls;
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
  // 3 列 × 3 段（9 個）まではそのまま。超えたら 6 個ずつ見せ、3 段目をページ送りに使う（ボタンを小さくしない）
  let cmdPage = 0;
  function renderCommands(group) {
    let items;
    if (group) items = [...group.targets.map(t => button(t, () => doCommand(`${group.base}→${t}`))), button('もどる', () => renderCommands())];
    else items = E.commands().map(c => button(c.targets.length ? c.base + ' →' : c.base, () => c.targets.length ? renderCommands(c) : doCommand(c.base)));
    if (items.length > 9) {
      const PER = 6, pages = Math.ceil(items.length / PER);
      cmdPage = Math.max(0, Math.min(cmdPage, pages - 1));
      items = items.slice(cmdPage * PER, cmdPage * PER + PER);
      while (items.length < PER) items.push(el('div'));
      items.push(button('← まえ', () => { cmdPage--; renderCommands(group); }, cmdPage > 0 ? '' : 'ghost'),
        el('div', 'page', `${cmdPage + 1} / ${pages}`),
        button('つぎ →', () => { cmdPage++; renderCommands(group); }, cmdPage < pages - 1 ? '' : 'ghost'));
    } else cmdPage = 0;
    ui.commands.replaceChildren(...items);
    ui.commands.classList.remove('hidden');
    ui.commands.classList.remove('busy');
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
    frag.appendChild(button(ui['btn-font'].textContent, function () { cycleFont(); this.textContent = ui['btn-font'].textContent; }));
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
  // クレジット（同梱フォントのライセンス表記。タイトルから）
  function showCredits() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'クレジット'));
    frag.appendChild(el('p', 'small', '「妹はネコ」は琴葉茜・琴葉葵の非公式ファンゲームです。キャラクターの権利は権利者に帰属します'));
    const ul = el('ul');
    const li1 = el('li', 'small', 'フォント: DotGothic16（Fontworks Inc.）— SIL Open Font License 1.1　');
    const a1 = el('a', null, 'ライセンス全文'); a1.href = 'fonts/LICENSE-DotGothic16-OFL.txt'; a1.target = '_blank'; a1.rel = 'noopener'; li1.appendChild(a1);
    const li2 = el('li', 'small', 'フォント: PixelMplus（M+ FONTS PROJECT）— M+ FONT LICENSE　');
    const a2 = el('a', null, 'ライセンス全文'); a2.href = 'fonts/LICENSE-PixelMplus-mplus.txt'; a2.target = '_blank'; a2.rel = 'noopener'; li2.appendChild(a2);
    ul.append(li1, li2);
    frag.appendChild(ul);
    frag.appendChild(el('p', 'small', 'フォントは台本で使う文字だけに絞った WOFF2 に変換して同梱しています（元のフォントは変更していません）'));
    frag.appendChild(button('とじる', closeMenu));
    p.replaceChildren(frag);
    ui.menu.classList.remove('hidden');
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
  // 位置の名前は、状態の位置（!葵 ゆか など）と、反応の中で寄る位置（!いち 葵 つくえあしもと。状態は変えない）の両方を引く
  const LAYOUTS = {
    // 机は x 24〜136。左から 茜（机の後ろ）・ノートPC・キーボードの猫・茜側のマグ×2・謎のときの猫・葵側のマグ×2。右端の前にスツール（葵の席）
    room: {
      茜: { つくえ: [32, 116], ソファ: [204, 140], ゆか: [140, 140], たち: [140, 140] },
      葵: {
        ゆか: [144, 140], つくえ: [74, 104], ソファ: [172, 132], となり: [187, 132],   // つくえ = キーボードの横。となり = ソファで茜にくっつく
        つくえみぎ: [108, 104], いす: [128, 130],   // 4章: マグの間（謎のとき）、スツールの上（葵の席）
        つくえあしもと: [44, 140], ソファあしもと: [186, 140],   // 茜の足元（机の前・ソファの前）
        つくえのひざ: [32, 106],   // 机の後ろ、茜の膝の上。頭だけ机から出る（render で机より先に描く）
      },
      葵人間: { ゆか: [168, 140], ソファ: [172, 140], ソファちかく: [178, 140], ソファぴったり: [188, 140], ネコのよこ: [156, 140] },   // 終章: 甘さで距離が変わる。ネコのよこ = 床のネコ茜のそば
      defaults: ['マグ', 'ノートPC', 'ペンたて', 'ほん', 'けしごむ'],
      props: { マグ: [90, 104], ノートPC: [42, 104], ペンたて: [110, 104], ほん: [116, 104], けしごむ: [104, 104], スマホ: [68, 104], かつおぶし: [60, 140], みず: [72, 140], スツール: [128, 140] },
      // 4章のおそろいのマグ: 置き場所は状態（月いち／日いち）で決まる
      propPos: { つきのマグ: () => (E.state.月いち === '葵側' ? [118, 104] : [84, 104]), たいようのマグ: () => (E.state.日いち === '葵側' ? [126, 104] : [92, 104]) },
      floorDrop: { ペンたて: [96, 140], けしごむ: [106, 140], ほん: [112, 140], マグ: [92, 140], スマホ: [92, 140] },
      slots: [[100, 104], [26, 104], [60, 104]],
    },
    town: {
      茜: { たち: [128, 140], ベンチ: [190, 131], だっこ: [128, 140] },   // ベンチ = 右端。お尻が座面（y 124〜128）に来る高さ
      葵: { ゆか: [92, 140], ベンチ: [168, 128], ベンチよこ: [174, 140], あしもと: [112, 140] },   // ベンチ = 座面の真ん中、茜の隣。ベンチよこ = 座った茜の足元。あしもと = 立った茜の足元
      葵人間: {},
      defaults: [],
      props: {},
      floorDrop: {},
      slots: [[40, 140], [60, 140]],
    },
    kitchen: {
      茜: { テーブル: [136, 116], ゆか: [88, 140], 冷蔵庫: [222, 140] },   // ゆか = テーブルの手前に出てくる（遊ぶ・撫でる）。冷蔵庫 = 冷蔵庫の前
      葵: { ゆか: [64, 140], テーブル: [112, 104], あしもと: [122, 140], ごはんまえ: [56, 140] },   // テーブル = プリンのすぐ左（茜はプリンの向こう側）
      defaults: [],
      props: { プリン: [124, 104], スプーン: [140, 104], 小さいスプーン: [192, 104], スマホ: [178, 104], ネコごはん: [32, 140], ごはんの小皿: [40, 140], ねこじゃらし: [52, 140], 猫砂: [16, 140], みず: [50, 140] },
      floorDrop: { スプーン: [104, 140] },
      slots: [[156, 104], [166, 104], [186, 104]],
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
    // 4章のおそろいのマグ。絵（月 = 青、太陽 = 赤）は向いている側に描く（茜向き = 左、葵向き = 右）
    'つきのマグ': (x, y) => { rect(x, y - 6, 6, 6, C.white); rect(x + 6, y - 5, 2, 3, C.white); rect(x + (E.state.月むき === '葵' ? 4 : 1), y - 4, 1, 2, '#3868a8'); },
    'たいようのマグ': (x, y) => { rect(x, y - 6, 6, 6, C.white); rect(x + 6, y - 5, 2, 3, C.white); rect(x + (E.state.日むき === '葵' ? 4 : 1), y - 4, 1, 2, C.sofa); },
    // 葵の席のスツール（机の前に置くので、机より濃い色で縁取る）
    'スツール': (x, y) => { rect(x - 7, y - 10, 14, 3, C.woodDark); rect(x - 6, y - 10, 12, 1, C.cabinet); rect(x - 6, y - 7, 2, 7, C.woodDark); rect(x + 4, y - 7, 2, 7, C.woodDark); },
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
    const hidden = v.hidden || {};
    const names = [...new Set([...L.defaults, ...Object.keys(v.props)])].filter(n => !hidden[n]);
    let slot = 0;
    for (const n of names) {
      const draw = PROP[n] || ((x, y) => { rect(x, y - 6, 6, 6, C.gray); rect(x + 1, y - 5, 4, 4, C.black); });
      let pos;
      if (v.fallen[n]) pos = L.floorDrop[n] || [L.props[n] ? L.props[n][0] + 20 : 120 + slot * 10, FLOOR_Y];
      else pos = (L.propPos && L.propPos[n] && L.propPos[n]()) || L.props[n] || L.slots[slot++ % L.slots.length];
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
    rect(24, 100, 112, 4, C.woodTop); rect(24, 104, 112, 36, C.wood); rect(28, 108, 36, 12, C.woodDark); rect(68, 108, 64, 12, C.woodDark);
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
  // 位置が変わったとき、瞬間移動ではなく数フレームかけて動かす（場面が変わったときは瞬時）
  const anim = { scene: '', pos: {} };
  let animPending = false;
  function tween(key, x, y) {
    const a = anim.pos[key];
    if (!a) { anim.pos[key] = { x, y }; return [x, y]; }
    const dx = x - a.x, dy = y - a.y;
    if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) { a.x = x; a.y = y; return [x, y]; }
    a.x += dx * 0.22; a.y += dy * 0.22;
    if (!animPending) { animPending = true; requestAnimationFrame(() => { animPending = false; render(); }); }
    return [Math.round(a.x), Math.round(a.y)];
  }
  function render() {
    if (game && game.draw) { game.draw(); return; }
    const v = E.visual;
    if (!v) return;
    const scene = v.scene || '';
    if (scene !== anim.scene) { anim.scene = scene; anim.pos = {}; }
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
    const spot = v.spot || {};   // 反応の中で寄った位置（状態の位置より優先）
    const akaneCat = E.state.茜すがた === 'ネコ';
    let ap = (spot.茜 && L.茜[spot.茜]) || L.茜[E.state.茜] || (akaneCat ? L.茜.ゆか : null);
    if (ap) ap = tween('茜', ap[0], ap[1]);
    const seated = (kind === 'room' && E.state.茜 === 'ソファ') || (kind === 'town' && E.state.茜 === 'ベンチ');
    // 葵の位置と絵を先に決める（描く順は、机の後ろ・膝の上だけ家具より先）
    const human = E.state.すがた === 'にんげん';
    let gp, sp;
    if (human) { gp = (L.葵人間 && L.葵人間[E.state.葵]) || [168, 140]; sp = humanSprite(String(E.state.葵).startsWith('ソファ') ? 'aoi_sit' : 'aoi_stand'); }
    else if (E.state.葵 === 'だっこ' && ap) { gp = [ap[0] + 6, ap[1] - 12]; sp = 'cat_sit'; }   // 茜の腕の中
    else { gp = (spot.葵 && L.葵[spot.葵]) || L.葵[E.state.葵]; sp = v.pose.葵 === 'ねころぶ' ? 'cat_lie' : 'cat_sit'; }
    if (gp) gp = tween('葵', gp[0], gp[1]);
    const onLap = !human && spot.葵 === 'つくえのひざ' && kind === 'room';   // 机の後ろ、茜の膝の上: 頭だけ机から出る
    if (ap && !akaneCat && !seated) drawSprite(humanSprite('akane_stand'), ap[0], ap[1]);   // 机の後ろに立つ（座って見える）
    if (gp && onLap) drawSprite(sp, gp[0], gp[1]);
    if (kind === 'room') drawRoomFront(); else if (kind === 'kitchen') drawKitchenFront(); else drawTownFront(place);
    if (ap && !akaneCat && seated) drawSprite(humanSprite('akane_sit'), ap[0], ap[1]);       // ソファやベンチの上に全身
    if (ap && akaneCat) drawSprite('cat_akane', ap[0], ap[1]);                                 // 隠しED: ネコの茜
    drawProps(L);
    if (gp && !onLap) drawSprite(sp, gp[0], gp[1]);
    if (v.pose.茜 === 'なでる' && gp) drawHeart(gp[0] + 10, gp[1] - 22);
    if (fadeAlpha > 0) rect(0, 0, 256, 160, `rgba(0,0,0,${fadeAlpha})`);
  }
  // 遊ぶ画面は決め打ちの大きさ（縦長 390×632、横長 896×392。内訳は style.css の先頭）を、見えている領域に収まる倍率で縮める
  const DESIGN = { portrait: [390, 632], landscape: [896, 392] };
  // 実際に見えている #app の内側（余白と safe-area を引いた大きさ）に収める。ページはスクロールさせない
  function fitCanvas() {
    const cs = getComputedStyle(ui.app);
    const vw = ui.app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const vh = ui.app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // 縦長・横長のうち、大きく出せる方の並びにする（横長の窓や、ブラウザの拡大表示で狭くなった画面でも必ず収まる）
    const sp = Math.min(vw / DESIGN.portrait[0], vh / DESIGN.portrait[1]);
    const sl = Math.min(vw / DESIGN.landscape[0], vh / DESIGN.landscape[1]);
    const landscape = sl > sp;
    const s = Math.min(landscape ? sl : sp, 1.6);
    ui.play.classList.toggle('portrait', !landscape);
    ui.play.classList.toggle('landscape', landscape);
    ui.play.style.setProperty('--s', String(Math.max(0.1, s)));   // 下限は付けない（付けると枠がはみ出し、ボタンを押したときに中がスクロールしてしまう）
  }

  // ---------- ミニゲーム ----------
  function startMinigame(ev) {
    ui.commands.classList.add('hidden');
    ui.minigame.classList.remove('hidden');
    ui.play.classList.add('game');   // ミニゲーム中は会話枠を縮めてコマンド枠を広げる
    ui['d-next'].classList.add('hidden');
    if (GAME_SKIP) { setTimeout(() => endGame('せいこう', ev.name === 'よみちさんぽ' ? { さんぽ: 'ふつう' } : undefined), 0); return; }   // 通常のスキップと同じ ふつう
    if (ev.name === 'キーボードれんだ') kbGame(ev.params);
    else if (ev.name === 'プリンまわし') puddingGame(ev.params);
    else if (ev.name === 'よみちさんぽ') walkGame(ev.params);
    else if (ev.name === 'エーオーアイ') aoiGame(ev.params);
    else { toast(`（ミニゲーム「${ev.name}」は未実装。成功あつかい）`); endGame('せいこう'); }
  }
  function endGame(result, set) {
    if (game && game.stop) game.stop();
    game = null;
    ui.minigame.classList.add('hidden');
    ui.minigame.replaceChildren();
    ui.play.classList.remove('game');
    ui.commands.classList.remove('hidden');
    ui.commands.classList.add('busy');
    mode = 'dialog';
    render();
    step({ result, set });
  }
  // 3章: お姉ちゃんについて歩く（v3。Codex 第17回の提案で、3 区間を別の遊びにした）
  //   区間1 住宅街「同じ道を歩く」: 茜が道を変えたら 1.5 秒以内に同じ道へ（▲▼）。誘惑なし。合流 2/3 以上で ぴったり
  //   区間2 公園「気になる。でも、ついていく」: 道は1本。かける（長押し・スタミナ）で距離を詰め、落ち葉は「みる」で寄り道してもいい
  //     距離 28〜52 がちょうどいい。84 で茜が待つ（おくれ）、12 まで詰めると追い抜く（さきばしり）。みる を押せば よりみち
  //   区間3 商店街「ここにいるよ」: 茜が振り向いて声をかけたら なく で返事。1.2 秒以内×2 で ぴったり。返事がなければ茜が待つ（おくれ）
  //   共通: 失敗も罰もない。スキップは ふつう。だっこ（1章で抱っこ済み）は何もしない 12 秒
  function walkGame(p) {
    const seg = Number(p.区間) || 1;
    const carried = !!p.だっこ;
    const total = (Number(p.長さ) || 18) * 1000;
    const t0 = Date.now();
    let done = false, scroll = 0;
    const title = el('div', 'title', '');
    const status = el('div', 'prog', '');
    const skipBtn = button('スキップ', () => finish('ふつう'), 'small');
    const statusRow = el('div', 'status'); statusRow.append(status, skipBtn);
    const bar = el('div', 'bar'); const fill = document.createElement('div'); fill.style.width = '0%'; bar.appendChild(fill);
    const bottom = el('div', 'row wide');
    ui.minigame.replaceChildren(title, statusRow, bar, bottom);
    function finish(grade) {
      if (done) return;
      done = true; clearInterval(timer);
      setTimeout(() => endGame('せいこう', { さんぽ: grade }), 300);
    }
    const say = s => { status.textContent = s; };
    const heart = (x, y) => drawHeart(x, y);
    const cue = (x, y) => { rect(x - 1, y, 2, 5, C.white); rect(x - 1, y + 6, 2, 2, C.white); };   // 「！」
    const FLOOR = 140;

    // ── 区間1: 同じ道を歩く ──
    function laneWalk() {
      const LANES = [124, 135, 147];
      const CAT_X = 72, AK_X = 128;
      let lane = 1, laneY = LANES[1], akLane = 1, akY = LANES[1], akOff = 0;
      let changeAt = 0, changeIsReal = false, hits = 0, stumbleUntil = 0, smileUntil = 0, cueUntil = 0;
      const plan = [{ t: 4000, real: false }, { t: 6500, real: true }, { t: 10500, real: true, puddle: true }, { t: 14500, real: true, puddle: true }];
      let next = 0;
      const items = [];
      const up = el('button', 'big', '▲ おく'), down = el('button', 'big', '▼ てまえ');
      const move = d => { if (done) return; lane = Math.max(0, Math.min(2, lane + d)); };
      up.onpointerdown = e => { e.preventDefault(); move(-1); };
      down.onpointerdown = e => { e.preventDefault(); move(1); };
      const col = el('div', 'col'); col.append(up, down);
      say('お姉ちゃんが道を変えたら、同じ道へ');
      return {
        title: '住宅街。お姉ちゃんと同じ道を歩く（▲▼）',
        buttons: [el('div'), col],
        key: e => { if (e.key === 'ArrowUp' || e.key === 'w') move(-1); else if (e.key === 'ArrowDown' || e.key === 's') move(1); },
        tick(t, dt, now) {
          scroll += 40 * dt;
          laneY += (LANES[lane] - laneY) * 0.35;
          akY += (LANES[akLane] - akY) * 0.2;
          akOff += (0 - akOff) * 0.05;
          if (next < plan.length && t >= plan[next].t) {   // 茜が道を変える（最後の 3 秒は変えない）
            const c = [0, 1, 2].filter(l => l !== akLane);
            const old = akLane;
            akLane = c[Math.floor(Math.random() * c.length)];
            changeAt = now; changeIsReal = plan[next].real; cueUntil = now + 1200;
            if (plan[next].puddle) items.push({ x: AK_X + 24, lane: old });   // 元の道の先に水たまり。茜はもうよけている
            say(plan[next].real ? '茜「こっちやで」' : '茜「ほら、こっちの道な。練習や」');
            next++;
          }
          if (changeAt && lane === akLane) {   // 合流
            if (now - changeAt <= 1500 && changeIsReal) hits++;
            if (now - changeAt <= 1500) { smileUntil = now + 900; say('茜がこっちを見て、笑った'); }
            changeAt = 0;
          }
          for (const it of items) {
            it.x -= 40 * dt;
            if (!it.hit && Math.abs(laneY - LANES[it.lane]) < 4 && it.x < CAT_X + 7 && it.x + 12 > CAT_X - 7) {
              it.hit = true; stumbleUntil = now + 500; akOff = -8; say('茜「大丈夫かー？ 足、濡れたな」');
            }
          }
          while (items.length && items[0].x < -24) items.shift();
          this.now = now; this.stumbling = now < stumbleUntil; this.smile = now < smileUntil; this.cue = now < cueUntil;
        },
        grade: () => (hits >= 2 ? 'ぴったり' : 'ふつう'),
        draw() {
          drawSky(false);
          const shades = ['#7a7a82', '#8a8a90', '#9a9aa0'];
          rect(0, 118, 256, 12, shades[0]); rect(0, 130, 256, 11, shades[1]); rect(0, 141, 256, 19, shades[2]);
          for (let x = -(scroll % 24); x < 256; x += 24) { rect(x, 129, 6, 1, '#b0b0b8'); rect(x + 12, 140, 6, 1, '#b0b0b8'); }
          for (let x = -((scroll * 0.5) % 48); x < 256; x += 48) { rect(x, 100, 4, 18, '#a08060'); rect(x, 100, 48, 2, '#a08060'); }
          const bob = Math.floor(scroll / 8) % 2;
          const layers = items.map(it => ({ y: LANES[it.lane], f: () => { const x = Math.round(it.x), y = LANES[it.lane]; rect(x, y - 2, 12, 2, '#5a8ac8'); rect(x + 2, y - 3, 8, 1, '#a0c8f0'); } }));
          layers.push({ y: akY, f: () => {
            const ax = Math.round(AK_X + akOff), ay = Math.round(akY);
            drawSprite(humanSprite('akane_stand'), ax, ay - bob);
            if (this.cue) cue(ax, ay - 42);
            if (this.smile) heart(ax + 10, ay - 40);
          } });
          layers.push({ y: laneY + 0.1, f: () => {
            const cy = Math.round(laneY);
            if (!(this.stumbling && Math.floor(this.now / 80) % 2)) drawSprite('cat_sit', CAT_X, cy - bob);
          } });
          layers.sort((a, b) => a.y - b.y).forEach(l => l.f());
        },
      };
    }

    // ── 区間2: 気になる。でも、ついていく ──
    function distWalk() {
      const CAT_X = 72;
      let d = 44, stamina = 1, dashing = false, catSpeed = 16, akSpeed = 20;
      let waiting = false, detourUntil = 0, lookUntil = 0, cooldownUntil = 0, smileUntil = 0, cueUntil = 0, aheadUntil = 0;
      let detours = 0, waits = 0, overtakes = 0, inBand = 0, operable = 0, looked = false;
      const tempts = [{ t: 4000, kind: 'おちば' }, { t: 10000, kind: 'くさのほ' }];
      let nextTempt = 0, tempt = null;   // { x, kind, until }
      const leaves = [];
      const dash = el('button', 'big hold', 'かける'); const gauge = el('div', 'gauge'); dash.appendChild(gauge);
      const look = el('button', 'big', 'みる');
      hold(dash, () => { dashing = true; }, () => { dashing = false; });
      look.onpointerdown = e => { e.preventDefault(); doLook(); };
      const doLook = () => {
        if (done || !tempt || Date.now() > tempt.until || Date.now() < detourUntil) return;
        detourUntil = Date.now() + 1500; detours++; tempt.until = 0; look.classList.remove('glow');
        for (let i = 0; i < 6; i++) leaves.push({ x: CAT_X + 8 + Math.random() * 12, y: FLOOR - 4 - Math.random() * 10, vx: 10 + Math.random() * 20, vy: -20 - Math.random() * 20 });
        say('……ちょっとだけ。茜「見終わってから行こか」');
      };
      say('ちょうどいい距離で歩く。離れたら「かける」');
      return {
        title: '公園。お姉ちゃんとの距離を見て、かける・やすむ',
        buttons: [dash, look],
        key: e => { if (e.key === ' ' || e.key === 'ArrowRight') dashing = true; else if (e.key === 'ArrowDown') doLook(); },
        keyup: e => { if (e.key === ' ' || e.key === 'ArrowRight') dashing = false; },
        tick(t, dt, now) {
          const detour = now < detourUntil;
          // 誘惑: 2 秒だけ「みる」が光る
          if (nextTempt < tempts.length && t >= tempts[nextTempt].t) { tempt = { x: CAT_X + 20, kind: tempts[nextTempt].kind, until: now + 2000 }; look.classList.add('glow'); say('……気になる。「みる」で寄り道してもいい'); nextTempt++; }
          if (tempt && now > tempt.until) look.classList.remove('glow');
          // 8 秒ごろ、茜が振り返って歩幅をゆるめる
          if (!looked && t >= 8000) { looked = true; lookUntil = now + 1000; cueUntil = now + 1000; say('茜が、振り返った'); }
          if (dashing && stamina > 0 && !detour) { stamina = Math.max(0, stamina - dt / 2); catSpeed = 40; }
          else { stamina = Math.min(1, stamina + dt / 2.5); catSpeed = detour ? 0 : 16; }
          gauge.style.width = (stamina * 100) + '%';
          akSpeed = detour || waiting ? 0 : now < lookUntil ? 10 : now < aheadUntil ? 30 : 20;
          if (now < aheadUntil && d < 32) akSpeed = 30;
          d += (akSpeed - catSpeed) * dt;
          scroll += catSpeed * dt;
          if (tempt) tempt.x -= catSpeed * dt;
          if (tempt && tempt.x < -20) tempt = null;
          leaves.forEach(l => { l.x += l.vx * dt; l.y += l.vy * dt; l.vy += 60 * dt; });
          while (leaves.length && leaves[0].y > FLOOR + 4) leaves.shift();
          const cool = now < cooldownUntil;
          if (!waiting && !detour && !cool && d >= 84) { waiting = true; waits++; cueUntil = now + 1200; say('茜「はよおいで。待ったるから」'); }
          if (waiting && d <= 52) { waiting = false; cooldownUntil = now + 2000; say('茜「ほな、行こか」'); }
          if (!detour && !cool && d <= 12 && now > aheadUntil) {   // 追い抜く: 猫が前へ出て、茜が笑って追いつく
            overtakes++; d = -16; aheadUntil = now + 2500; cooldownUntil = now + 2500; smileUntil = now + 1200; dashing = false;
            say('茜「こら、先行ったらあかん！ ……元気やなぁ」');
          }
          if (now >= aheadUntil && aheadUntil && d > 32) { aheadUntil = 0; }
          if (!detour && !waiting && !cool) { operable += dt; if (d >= 28 && d <= 52) inBand += dt; }
          this.now = now; this.smile = now < smileUntil; this.cue = now < cueUntil; this.detour = detour; this.band = d >= 28 && d <= 52;
          this.d = d;
        },
        grade: () => (detours ? 'よりみち' : waits ? 'おくれ' : overtakes ? 'さきばしり' : operable && inBand / operable >= 0.6 ? 'ぴったり' : 'ふつう'),
        draw() {
          drawSky(false);
          rect(0, 118, 256, 42, '#4a8a40');
          for (let x = -(scroll % 32); x < 256; x += 32) rect(x, 118, 1, 42, '#3a7a30');
          for (let x = -((scroll * 0.5) % 64); x < 256; x += 64) { rect(x + 10, 92, 6, 26, '#6a4020'); rect(x, 64, 26, 32, '#3a7a30'); }
          const bob = Math.floor(scroll / 8) % 2;
          if (tempt) { const x = Math.round(tempt.x), y = FLOOR; if (tempt.kind === 'おちば') { rect(x, y - 4, 3, 2, '#d08030'); rect(x + 4, y - 3, 3, 2, '#e0a040'); rect(x + 1, y - 5, 1, 1, '#d08030'); } else { rect(x + 2, y - 8, 1, 8, '#8aa050'); rect(x + 1, y - 11, 3, 3, '#d8c890'); } }
          leaves.forEach(l => rect(Math.round(l.x), Math.round(l.y), 2, 2, '#d08030'));
          const ax = Math.round(CAT_X + this.d), ay = FLOOR;
          const order = this.d >= 0 ? ['cat', 'akane'] : ['akane', 'cat'];
          for (const who of order) {
            if (who === 'akane') {
              drawSprite(humanSprite('akane_stand'), ax, ay - (this.band ? bob : 0));
              if (this.cue) cue(ax, ay - 42);
              if (this.smile) heart(ax + 10, ay - 40);
            } else {
              drawSprite('cat_sit', CAT_X, FLOOR - (this.detour ? 0 : bob));
              if (this.detour) { rect(CAT_X - 1, FLOOR - 24, 2, 4, C.yellow); rect(CAT_X - 1, FLOOR - 19, 2, 1, C.yellow); }
            }
          }
        },
      };
    }

    // ── 区間3: ここにいるよ ──
    function callWalk() {
      const CAT_X = 72;
      let d = 36, calls = 0, fast = 0, waited = false, callAt = 0, callUntil = 0, waitUntil = 0, smileUntil = 0, nodUntil = 0;
      const plan = [{ t: 3000, s: 'そこ、おる？' }, { t: 7000, s: 'こっちやで' }, { t: 11000, s: '……一緒に行こか' }];
      let next = 0;
      const meow = el('button', 'big', 'なく');
      const answer = () => {
        if (done) return;
        const now = Date.now();
        if (callAt && now <= callUntil) {
          if (now - callAt <= 1200) { fast++; smileUntil = now + 1000; say('にゃあ。……茜が、笑った'); }
          else { nodUntil = now + 800; say('にゃ。……茜が、うなずいた'); }
          callAt = 0; callUntil = 0;
        } else say('にゃ');
      };
      meow.onpointerdown = e => { e.preventDefault(); answer(); };
      say('お姉ちゃんが声をかけたら、「なく」で返事');
      return {
        title: '商店街。声をかけられたら、返事をする',
        buttons: [el('div'), meow, el('div')],
        key: e => { if (e.key === ' ' || e.key === 'Enter') answer(); },
        tick(t, dt, now) {
          const speed = 28 - 10 * Math.min(1, t / total);
          const quiet = t > total - 5000;
          if (next < plan.length && t >= plan[next].t) { callAt = now; callUntil = now + 2000; calls++; say(`茜「${plan[next].s}」`); next++; }
          if (callAt && now > callUntil) { callAt = 0; callUntil = 0; waited = true; waitUntil = now + 1200; say('茜「……おるな」（足元を確かめた）'); }
          const akSpeed = now < waitUntil ? 0 : speed;
          if (now < waitUntil) d -= speed * dt; else if (quiet) d += (20 - d) * dt * 1.5; else d += (36 - d) * dt;
          scroll += speed * dt;
          this.now = now; this.calling = !!callAt; this.smile = now < smileUntil; this.nod = now < nodUntil; this.d = d; this.quiet = quiet;
        },
        grade: () => (!waited && fast >= 2 ? 'ぴったり' : waited ? 'おくれ' : 'ふつう'),
        draw() {
          drawSky(false);
          rect(0, 118, 256, 42, '#8a8a90');
          for (let x = -(scroll % 32); x < 256; x += 32) rect(x, 118, 1, 42, '#707078');
          for (let x = -((scroll * 0.5) % 64); x < 256 + 64; x += 64) { rect(x, 50, 40, 68, '#d8c8b0'); rect(x + 2, 64, 36, 8, C.sofa); rect(x + 14, 90, 12, 28, '#504030'); }
          const bob = Math.floor(scroll / 8) % 2;
          const ax = Math.round(CAT_X + this.d), ay = FLOOR;
          drawSprite('cat_sit', CAT_X, FLOOR - bob);
          drawSprite(humanSprite('akane_stand'), ax, ay - (this.nod ? 1 : bob));
          if (this.calling) cue(ax, ay - 42);
          if (this.smile) heart(ax + 10, ay - 40);
        },
      };
    }

    // ── だっこ: 何もしなくていい ──
    function carriedWalk() {
      say('お姉ちゃんの腕の中。ゆられている');
      return {
        title: '抱っこで進む。何もしなくていい',
        buttons: [],
        tick(t, dt) { scroll += 40 * dt; },
        grade: () => 'だっこ',
        draw() {
          drawSky(false);
          rect(0, 118, 256, 42, '#4a8a40');
          for (let x = -(scroll % 32); x < 256; x += 32) rect(x, 118, 1, 42, '#3a7a30');
          for (let x = -((scroll * 0.5) % 64); x < 256; x += 64) { rect(x + 10, 92, 6, 26, '#6a4020'); rect(x, 64, 26, 32, '#3a7a30'); }
          const bob = Math.floor(scroll / 8) % 2;
          drawSprite(humanSprite('akane_stand'), 120, FLOOR - bob);
          drawSprite('cat_sit', 126, FLOOR - 12 - bob);
        },
      };
    }

    const impl = carried ? carriedWalk() : seg === 1 ? laneWalk() : seg === 2 ? distWalk() : callWalk();
    title.textContent = impl.title;
    impl.buttons.forEach(b => bottom.appendChild(b));
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(), t = now - t0, dt = Math.min(0.1, (now - last) / 1000); last = now;
      impl.tick(t, dt, now);
      fill.style.width = Math.min(100, t / total * 100) + '%';
      render();
      if (t >= total) finish(impl.grade());
    }, 33);
    game = {
      stop: () => clearInterval(timer),
      key: e => { if (impl.key) impl.key(e); },
      keyup: e => { if (impl.keyup) impl.keyup(e); },
      draw: () => impl.draw(),
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
    if (mode === 'つめ') ctl.appendChild(button('けす', erase, 'small'));
    ctl.appendChild(button('やめる', () => finish('しっぱい'), 'small'));
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
    const L = el('button', 'big arrow', '◀'), R = el('button', 'big arrow', '▶');
    const row = el('div', 'row'); row.append(L, dial, R);   // 枠に収めるため、皿の両わきにボタン
    ui.minigame.replaceChildren(el('div', 'title', 'プリンをまわして、「あおい」をお姉ちゃんに向けよう（◀ ▶ の長押しで回る。PCは ← →）'), row);
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
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCanvas);   // スマホのアドレスバーの出入り
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
    setDialog('', 'つづきから', 'nare', false);
    ui.objective.textContent = E.visual.objective || '';
    updateFound();
    renderCommands();
    render();
  };
  ui['btn-size'].onclick = cycleSize;
  ui['btn-font'].onclick = cycleFont;
  ui['btn-credits'].onclick = showCredits;
  ui['btn-costume'].onclick = cycleCostume;
  ui['btn-menu'].onclick = openMenu;   // メニューは常に出しておく
  ui['btn-found'].onclick = () => { showFound(); ui.menu.classList.remove('hidden'); };

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
