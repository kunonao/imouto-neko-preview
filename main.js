// 妹はネコ 画面側（描画・入力・保存・ミニゲーム）。ゲームの中身は engine.js。
(function () {
  'use strict';

  const DATA = window.GAME_DATA;
  const E = new window.Engine(DATA);
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'imouto-neko-v1';
  const SETTINGS_KEY = 'imouto-neko-settings';
  const ENDINGS_KEY = 'imouto-neko-endings';
  const ROUTES_KEY = 'imouto-neko-routes';   // 見た「クリアのしかた」（章ごとの終わり方）: ["1:冷めたお茶", ...]
  // 台本の「!set ルート=名前」を章ごとに集めた一覧（登場順）
  const ROUTES = (() => {
    const per = [];
    const walk = (items, names) => items.forEach(it => {
      if (it.type === 'cmd' && it.name === 'set') { const m = it.args.match(/^ルート=(.+)$/); if (m && !names.includes(m[1])) names.push(m[1]); }
      if (it.type === 'minigame') Object.values(it.branches).forEach(b => walk(b, names));
    });
    DATA.chapters.forEach(ch => { const names = []; ch.blocks.forEach(b => walk(b.items, names)); per.push(names); });
    return per;
  })();
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
  const settings = { costume: 'new', font: 'pixel' };   // font: pixel = PixelMplus12（ファミコン風。既定）/ std = 端末の書体。衣装の既定は A.I.VOICE2。文字の大きさの設定は廃止（遊ぶ画面は決め打ちの大きさを倍率で縮めるので効かなかった。ユーザー判断 2026-10-23）
  const FONT_LABEL = { pixel: '文字: ファミコン風', std: '文字: 標準' };
  const FONT_NEXT = { pixel: 'std', std: 'pixel' };
  const COSTUME_LABEL = { old: '衣装: Kotonoha Talk', new: '衣装: A.I.VOICE2', en: '衣装: A.I.VOICE English' };   // 製品名でそろえる（ユーザー決定 2026-10-23）。old = Kotonoha Talk DL版（A.I.VOICE 琴葉 茜・葵 中国語版）の立ち絵の衣装
  const COSTUME_NEXT = { new: 'old', old: 'en', en: 'new' };
  // 台本の「!衣装 …」と設定の値を、素材 id の接尾辞に直す
  const COSTUME_SUFFIX = { old: '', new: '_v2', en: '_en', 中文: '', 中文版: '', 旧: '', 新: '_v2', English: '_en', 英: '_en' };
  const params = new URLSearchParams(location.search);
  const SKIP = params.get('skip') === '1';   // 確認用: 台詞を自動で送る
  const AUTO = (params.get('play') || '').split(',').filter(Boolean);   // 確認用: コマンドを順に自動実行
  const STOP = params.get('stop') || '';
  const BOT = params.get('walkbot') || '';   // 確認用の自動プレイヤー: idle（何もしない）/ follow（ついていく）/ lead（追い越して案内）/ curious（気になる物を見に行く）
  const DEBUG_LOG = params.get('debug') === '1' ? (() => { const d = document.createElement('pre'); d.id = 'debug-log'; d.style.display = 'none'; document.body.appendChild(d); return d; })() : null;
  const dlog = o => { if (DEBUG_LOG) DEBUG_LOG.textContent += JSON.stringify(o) + '\n'; };   // 確認用: skip=1 のとき、この文字を含む台詞で自動送りを止める（途中の絵を見る）
  const GAME_SKIP = params.get('game') === 'skip';   // 確認用: ミニゲームを成功あつかいで飛ばす

  let mode = 'title';   // title | dialog | commands | minigame | end
  let lastCmdAt = 0;
  let fadeAlpha = 0;
  let game = null;      // 実行中のミニゲーム（キー入力の受け口）
  let pickerOpen = false;   // エンディング選択中（背景タップや Escape で閉じると進行が止まるので閉じない）

  const ui = {};
  ['app', 'title', 'play', 'stage', 'stage-wrap', 'objective', 'dialog', 'd-name', 'd-text', 'd-next', 'commands', 'minigame', 'panel', 'btn-menu',
    'menu', 'menu-panel', 'chapter-end', 'ce-title', 'ce-text', 'btn-next', 'toast', 'btn-new', 'btn-continue', 'btn-memories', 'btn-font', 'btn-costume', 'btn-credits',
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
    store.set(SAVE_KEY, { snap: { v: 1, chapterIndex: i, fresh: true, found: s.found, special: s.special, runFound: s.runFound, runSpecial: s.runSpecial, runCleared: s.runCleared, runRoutes: s.runRoutes, hints: s.hints, runAt: s.runAt } });
  }
  function seenEndings() { const a = store.get(ENDINGS_KEY); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  function rememberEnding(name) { const a = seenEndings(); if (name && !a.includes(name)) { a.push(name); store.set(ENDINGS_KEY, a); } }
  function seenRoutes() { const a = store.get(ROUTES_KEY); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  function rememberRoute(ci, name) { const k = `${ci + 1}:${name}`; const a = seenRoutes(); if (name && name !== 'なし' && !a.includes(k)) { a.push(k); store.set(ROUTES_KEY, a); } }
  function loadProgress() {
    const d = store.get(SAVE_KEY);
    if (!d || !d.snap || d.snap.v !== 1 || !Number.isInteger(d.snap.chapterIndex)) return null;
    if (!DATA.chapters[d.snap.chapterIndex]) return null;
    if (!d.snap.fresh && (typeof d.snap.state !== 'object' || !d.snap.state)) return null;
    return d.snap;
  }
  function loadSettings() {
    const s = store.get(SETTINGS_KEY);
    if (s && COSTUME_LABEL[s.costume]) settings.costume = s.costume;
    if (s && FONT_LABEL[s.font]) settings.font = s.font;
    if (s && s.font === 'dot') settings.font = 'pixel';   // 旧設定（DotGothic16）はファミコン風へ
    if (FONT_LABEL[params.get('font')]) settings.font = params.get('font');   // 確認用: ?font=dot|pixel|std
  }
  function applySize() {   // 設定を画面に反映する（文字種・衣装）
    document.body.className = settings.font === 'std' ? 'font-std' : '';
    ui['btn-font'].textContent = FONT_LABEL[settings.font];
    ui['btn-costume'].textContent = COSTUME_LABEL[settings.costume];
  }
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
    ui['btn-found'].textContent = `はっけん ${c.run}/${c.total}` + (c.specialTotal ? ` ★${c.runSpecial}/${c.specialTotal}` : '');   // 今回の周回の数（過去の周回ぶんは おもいで で）
  }
  // 画面全体のカード（章と目標の提示）。最初の 1.5 秒はタップを無視して必ず見せる（連打していても消えない）。その後はタップで閉じ、2.8 秒で自動的に閉じる
  function showCard(small, label, big, done) {
    const card = ui.card;
    ui['card-small'].textContent = small;
    ui['card-label'].textContent = label;
    ui['card-big'].textContent = big;
    card.classList.remove('hidden');
    card.classList.add('locked');
    mode = 'card';   // 表示中はキーやタップで裏の会話が進まないように
    const shownAt = Date.now();
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(t); clearTimeout(u); card.classList.add('hidden'); card.onclick = null; done(); };
    const t = setTimeout(finish, 2800);
    const u = setTimeout(() => card.classList.remove('locked'), 1500);
    card.onclick = () => { if (Date.now() - shownAt >= 1500) finish(); };
  }
  function button(label, fn, cls) { const b = el('button', cls, label); b.onclick = fn; return b; }

  function stopGame() { if (game && game.stop) game.stop(); game = null; }
  function endLater(ms, result, set) { const g = game; setTimeout(() => { if (game === g) endGame(result, set); }, ms); }   // 終了待ちの間に章が変わった（game が入れ替わった）ら流し込まない   // 動いているミニゲームのタイマーを止める（章の切り替え・タイトルへ のとき。止めないと裏で回り続け、終わったときに別の章へ結果を流し込む）
  function initTitle() {
    mode = 'title'; stopGame();
    { const snap = loadProgress(); ui['btn-continue'].classList.toggle('hidden', !snap || (snap.fresh && snap.chapterIndex === 0)); }   // 最後まで行ったあとの保存（1章の頭）は はじめから と同じなので出さない
    showScreen('title');
  }

  function startChapter(i) {
    stopGame();
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
    cands.forEach(n => frag.appendChild(button(seen.includes(n) ? `${n}（見た）` : `${n}（はじめて）`, () => { pickerOpen = false; closeMenu(); done(n); })));
    p.replaceChildren(frag);
    showScreen('play');
    pickerOpen = true;
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
  function applyDebugState() {   // 確認用: ?state=茜:ソファ,葵:ソファ で位置や状態を直接見る（止まった台詞の時点で適用）
    const st = params.get('state'); if (!st) return;
    for (const kv of st.split(',')) { const i = kv.indexOf(':'); if (i > 0) E.state[kv.slice(0, i)] = kv.slice(i + 1); }
    anim.pos = {};   // 補間せず最終位置で描く（確認用）
    render();
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
        else if (STOP && ev.text.includes(STOP)) applyDebugState();   // 止まった時点で ?state= を効かせる（自動送りに上書きされない）
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
    if (ev.fresh.length) showDisc(ev.fresh);
    updateFound();   // 今回の周回の数は再発見でも増える
    if (ev.cleared && params.get('hold') === '1') { mode = 'commands'; return; }   // 確認用: クリア画面に進まず最後の場面で止まる
    if (ev.cleared) {
      const next = E.chapterIndex + 1;
      const route = E.state.ルート && E.state.ルート !== 'なし' ? E.state.ルート : '';
      if (route) { rememberRoute(E.chapterIndex, route); E.runRoutes[E.chapterIndex] = route; }   // 保存より先に今回のルートを記録（章末で再読み込みしても「今回」のまま）
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
      const route = E.state.ルート && E.state.ルート !== 'なし' ? E.state.ルート : '';
      ui['ce-title'].textContent = E.chapter.title + '　クリア';
      // ここでは「どのルートだったか」だけ示す（何通りあるか・集まり具合はメニューの「エンディング」で）
      ui['ce-text'].textContent = (route ? `クリアルート「${route}」\n\n` : '') +
        `はっけん ${c.run} / ${c.total}　　とくべつ ${c.runSpecial} / ${c.specialTotal}`;   // 今回の周回
      ui['btn-next'].textContent = 'つぎの章へ';
      ui['btn-next'].onclick = () => startChapter(E.chapterIndex + 1);
    } else {
      rememberEnding(E.ending);
      const t = totals(), seen = seenEndings();
      ui['ce-title'].textContent = E.ending ? `エンディング『${E.ending}』` : 'おしまい';
      ui['ce-text'].textContent = `今回：はっけん ${t.run} / ${t.total}　とくべつ ${t.runSpecial} / ${t.specialTotal}\nこれまでに見たエンディング ${seen.length} / ${ENDINGS.length}` +   // 今回と累計は別の行に（Codex 第32回）
        '\n\n終わり方は、一日の過ごし方で変わります。見たものはタイトルの「おもいで」で確認できます' +
        '\n\n（試作版。音声はこれから）';
      ui['btn-next'].textContent = 'タイトルへ';
      ui['btn-next'].onclick = initTitle;
    }
    showScreen('chapter-end');
    mode = 'end';
  }
  function totals() {
    const all = DATA.chapters.flatMap((ch, ci) => { const ids = new Set(); return ch.blocks.flatMap(b => b.discoveries).filter(d => !ids.has(d.id) && ids.add(d.id)); });
    return { found: Object.keys(E.found).length, total: all.filter(d => !d.special).length, special: Object.keys(E.special).length, specialTotal: all.filter(d => d.special).length, run: Object.keys(E.runFound).length, runSpecial: Object.keys(E.runSpecial).length };
  }

  // ---------- 会話 ----------
  function setDialog(name, text, cls, next) {
    ui['d-name'].textContent = name;
    ui['d-text'].textContent = text;
    ui.dialog.className = 'dialog frame ' + cls;
    ui['d-next'].classList.toggle('hidden', !next);
  }
  function showSay(it) {
    if (it.hint) { setDialog('', it.text, 'hint', true); return; }   // ヒント: 話者名なし（葵の心の声ではない）
    const sp = it.speaker;
    let name = '', cls = 'nare';
    if (sp === '茜') { name = '茜'; cls = 'akane'; }
    else if (sp === '葵') { name = '葵'; cls = 'aoi'; }
    else if (sp === 'こころ') { name = '葵（こころのこえ）'; cls = 'kokoro'; }
    else if (sp === '茜こころ') { name = '茜（こころのこえ）'; cls = 'akokoro'; }
    // 表情・演技は顔グラができるまで仮に名前へ添える
    if (it.tag && sp !== 'ナレ') name += `（${it.tag}）`;
    setDialog(name, it.text, cls + (it.special ? ' special' : ''), true);   // とくべつ の場面は枠と話者名が金色
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
  // 二段のメニュー。概念でまとめる: ヒント／おもいで（はっけん・エンディング・ルート）／せってい（文字・衣装）／章をえらぶ
  function openMenu() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'メニュー'));
    if (E.hasHint()) frag.appendChild(button('ヒント（終わり方には影響しません）', () => { closeMenu(); if (mode !== 'commands') { toast('ヒントは、行動を選べるときに見られます'); return; } doCommand('ヒント'); }));
    frag.appendChild(button('おもいで', showMemories));
    frag.appendChild(button('せってい', showSettings));
    frag.appendChild(button('章をえらぶ', showChapters));
    frag.appendChild(button('タイトルへ', () => { closeMenu(); initTitle(); }));
    frag.appendChild(button('とじる', closeMenu));
    p.replaceChildren(frag);
    ui.menu.classList.remove('hidden');
  }
  function closeMenu() { ui.menu.classList.add('hidden'); }
  // おもいで の「思い出すヒント」: 解放済みの行を押すと、板の下の欄に出す（一覧は広げない。板の高さは固定）
  function hintBox() { return el('p', 'hint', '見つけたものを押すと、思い出すヒントが出ます'); }
  function pickable(li, box, text) {
    if (!text) return;
    li.classList.add('pick');
    li.onclick = () => { box.textContent = text; li.parentNode.querySelectorAll('li.sel').forEach(x => x.classList.remove('sel')); li.classList.add('sel'); };
  }
  function legend(prefix) {   // おもいで の凡例: ■ 今回の周回 ／ □ 前の周回 ／ ？？？ まだ（文字の接尾ではなく印にする。2 列の一覧で折り返さないように）
    const p = el('p', 'note'); if (prefix) p.append(prefix);
    p.append(el('span', 'key', '今回の周回'), '　', el('span', 'key past', '以前の記録'), '　？？？ まだ');   // 以前 = 前の周回と、章をえらび直す前の記録
    return p;
  }
  function showMemories() {
    const p = ui['menu-panel'];
    const t = totals(), seen = seenEndings(), routesSeen = seenRoutes(), totalRoutes = ROUTES.reduce((n, r) => n + r.length, 0);
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'おもいで'));
    // 小さいものから大きいものへ: はっけん（場面） → ルート（章） → エンディング（一日）。ユーザー指定 2026-10-23
    frag.appendChild(button(`はっけん　${t.found} / ${t.total}　★ ${t.special} / ${t.specialTotal}`, () => showFound()));
    frag.appendChild(button(`クリアルート　${routesSeen.length} / ${totalRoutes}`, showRoutes));
    frag.appendChild(button(`エンディング　${seen.length} / ${ENDINGS.length}`, showEndings));
    frag.appendChild(mode === 'title' ? button('とじる', closeMenu) : button('もどる', openMenu));   // タイトルからは とじる
    p.replaceChildren(frag);
  }
  function showSettings() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'せってい'));
    // 押すたびに欄を作り直す（ボタンの文字を手で書き換えない。設定の値から毎回引く）
    frag.appendChild(button(FONT_LABEL[settings.font], () => { cycleFont(); showSettings(); }));
    const changed = E.visual && E.visual.costume === 'べつ';   // 終章は台本で「昨日と違う服」。設定の次の衣装が出るので、そのときだけ補足して不具合と思われないように
    const short = k => COSTUME_LABEL[k].replace('衣装: ', '');
    frag.appendChild(button(COSTUME_LABEL[settings.costume] + (changed ? `（今朝は ${short(COSTUME_NEXT[settings.costume])}）` : ''), () => { cycleCostume(); showSettings(); }));   // 終章は台本で「昨日と違う服」= 設定の次の衣装
    frag.appendChild(button('もどる', openMenu));
    p.replaceChildren(frag);
  }
  function showRoutes() {
    const p = ui['menu-panel'];
    const routesSeen = seenRoutes(), totalRoutes = ROUTES.reduce((n, r) => n + r.length, 0);
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, `クリアルート ${routesSeen.length} / ${totalRoutes}`));
    frag.appendChild(el('p', 'note', '章ごとのクリアのしかた（どの終わり方で章を終えたか）'));
    frag.appendChild(legend());   // 凡例だけ（前置きを付けると 2 行になる）
    const box = hintBox();
    DATA.chapters.forEach((ch, ci) => {
      if (!ROUTES[ci].length) return;
      const ul = el('ul');
      ROUTES[ci].forEach(n => {
        const ok = routesSeen.includes(`${ci + 1}:${n}`), now = E.runRoutes[ci] === n;
        const li = el('li', !ok ? 'todo' : now ? '' : 'past', !ok ? '？？？' : n);
        if (ok) pickable(li, box, (ch.routeHints || {})[n] || `${ci + 1}章`);
        ul.appendChild(li);
      });
      frag.appendChild(el('p', 'small', ch.title));
      frag.appendChild(ul);
    });
    frag.appendChild(box);
    frag.appendChild(button('もどる', showMemories));
    p.replaceChildren(frag);
  }
  let foundView = null;   // おもいで の はっけん で見ている章（進行は変えない）
  function showFound(ci) {
    if (typeof ci !== 'number') ci = foundView != null ? foundView : (E.chapter ? E.chapterIndex : 0);
    foundView = ci;
    const p = ui['menu-panel'];
    const c = E.counts(ci);
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'はっけん'));
    const tabs = el('div', 'tabs');   // 章の切り替え（見るだけ。進行は変えない）
    DATA.chapters.forEach((ch, i) => { if (E.counts(i).total) tabs.appendChild(button(`${i + 1}章`, () => showFound(i), i === ci ? 'on' : '')); });
    frag.appendChild(tabs);
    frag.appendChild(el('p', 'note', `集めた数 ${c.found} / ${c.total}　とくべつ ${c.special} / ${c.specialTotal}　この周回で ${c.run}`));   // 上の帯は今回の周回の数。ここは以前を含む
    frag.appendChild(legend());
    const ul = el('ul', 'two');   // 26 件を 2 列で（板の高さに収める）
    const box = hintBox();
    E.discoveryList(ci).forEach(d => {   // 今回の周回で見つけた / 以前だけ（薄く）/ まだ
      const cls = !d.name ? 'todo' : ((d.run ? '' : 'past ') + (d.special ? 'special' : '')).trim();
      const li = el('li', cls, d.name ? (d.special ? '★ ' : '') + d.name : '？？？');
      if (d.name) pickable(li, box, [`${ci + 1}章`, d.where, d.hint].filter(Boolean).join('　'));   // 自動（章＋コマンド）＋ 手書きの補足
      ul.appendChild(li);
    });
    frag.appendChild(ul);
    frag.appendChild(el('p', 'note', '★ は姉妹の思い出（各章に 1 つ）。同じ周回で 4 つそろうと、いつもと違う朝になるかも'));
    frag.appendChild(box);
    frag.appendChild(button('もどる', showMemories));
    p.replaceChildren(frag);
  }
  function showEndings() {
    const p = ui['menu-panel'];
    const seen = seenEndings();
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, `エンディング ${seen.length} / ${ENDINGS.length}`));
    const ul = el('ul');
    const box = hintBox(), eh = (DATA.chapters[DATA.chapters.length - 1].endingHints) || {};
    ENDINGS.forEach(n => {
      const ok = seen.includes(n), now = E.ending === n;
      const li = el('li', !ok ? 'todo' : now ? '' : 'past', !ok ? '？？？' : n);
      if (ok) pickable(li, box, eh[n] || '');
      ul.appendChild(li);
    });   // 今回の周回で着いたものだけ濃く
    frag.appendChild(ul);
    frag.appendChild(legend());
    frag.appendChild(el('p', 'note', '一日の過ごし方（よく食べた、よく甘えた、など）で変わります。条件を満たした終わり方が複数あれば、終章の前に選べます'));
    frag.appendChild(box);   // ヒント欄はいちばん下（他の一覧と同じ）
    frag.appendChild(button('もどる', showMemories));
    p.replaceChildren(frag);
  }
  // クレジット（同梱フォントのライセンス表記。タイトルから）
  function showCredits() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, 'クレジット'));
    const box = el('div', 'selectable');   // クレジットだけは文字を選んで写せる（ほかの画面はゲームらしく選べない）
    frag.appendChild(box);
    box.appendChild(el('p', 'small', '「妹はネコ」は琴葉茜・琴葉葵の非公式ファンゲームです。キャラクターの権利は権利者に帰属します'));
    const ul = el('ul');
    const li2 = el('li', 'small', 'フォント: PixelMplus（M+ FONTS PROJECT）— M+ FONT LICENSE　');
    const a2 = el('a', null, 'ライセンス全文'); a2.href = 'fonts/LICENSE-PixelMplus-mplus.txt'; a2.target = '_blank'; a2.rel = 'noopener'; li2.appendChild(a2);
    ul.append(li2);
    box.appendChild(ul);
    box.appendChild(el('p', 'small', 'フォントは台本で使う文字だけに絞った WOFF2 に変換して同梱しています（元のフォントは変更していません）'));
    frag.appendChild(button('とじる', closeMenu));
    p.replaceChildren(frag);
    ui.menu.classList.remove('hidden');
  }
  function showChapters() {
    const p = ui['menu-panel'];
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', null, '章をえらぶ'));
    frag.appendChild(el('p', 'note', '選んだ章の最初からやり直します。その章から先の今回の記録は戻り、1章を選ぶと新しい周回になります。集めたはっけんは残ります'));
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
      茜: { つくえ: [32, 116], ソファ: [204, 140], ゆか: [140, 140], たち: [140, 140] },   // ソファ = 足は床、お尻は低い座面（y 133〜140）に乗る
      葵: {
        ゆか: [144, 140], つくえ: [74, 104], ソファ: [172, 137], となり: [187, 137],   // つくえ = キーボードの横。となり = ソファで茜にくっつく
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
    // 壁の写真: 最初の合同誌ができた日。机の端と端に茜（桃）と葵（青）、それぞれの側にマグ（茜側 = 青い月、葵側 = 赤い太陽）、真ん中に本（4章の事実に合わせる。書き込みは最小限）
    rect(176, 84, 20, 14, C.woodDark); rect(178, 86, 16, 10, C.window);
    rect(179, 92, 14, 1, C.wood);                                                   // 机
    rect(180, 87, 2, 2, C.akane); rect(180, 89, 2, 3, C.sofa);                     // 茜（左）
    rect(190, 87, 2, 2, C.aoi); rect(190, 89, 2, 3, '#3868a8');                     // 葵（右）
    rect(183, 90, 1, 2, '#5a8ac8'); rect(188, 90, 1, 2, C.sofaDark);                // 月のマグ（茜側）・太陽のマグ（葵側）
    rect(185, 91, 2, 1, C.white);                                                   // 二人の間の本
  }
  function drawRoomFront() {
    rect(24, 100, 112, 4, C.woodTop); rect(24, 104, 112, 36, C.wood); rect(28, 108, 36, 12, C.woodDark); rect(68, 108, 64, 12, C.woodDark);
    // ソファは低め。座った茜はこの上に描く（render 側）
    // 低いソファ: 背もたれ y 116〜133、座面 y 133〜140（床のすぐ上）。座る人は足が床（y 140）、お尻が座面に来る（座面を高くすると座面の上に立って見える。ユーザー指摘 2026-10-24）
    rect(160, 116, 80, 17, C.sofaDark); rect(160, 116, 80, 3, C.sofa);
    rect(160, 133, 80, 7, C.sofa); rect(160, 139, 80, 1, C.sofaDark);
    rect(154, 112, 6, 28, C.sofa); rect(240, 112, 6, 28, C.sofa);
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
    document.documentElement.style.setProperty('--sm', String(Math.max(0.1, Math.min(sp, 1.6))));   // タイトル・章の終わり・メニュー・カードの倍率（縦長の設計に対する比。拡大してもスクロールを出さない）
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
  // 3章: お姉ちゃんについて歩く（v5。一本のゲーム・段階式・各区間 60/55/55 秒。Codex 第20・21回と合意）
  //   役割を固定する: 誘惑は「離れる方へ道替え」で振り切る／距離は「ダッシュ」／呼びかけは「なく」
  //   土台（全区間）: 3 本の道を ▲▼。足元の障害は道を変えてよける（当たると 0.5 秒つまずくだけ）。
  //     誘惑は端の道にだけ出る。予兆「？」0.8 秒 → 体が寄る 1.2 秒。その 2 秒以内に誘惑から離れる方へ 1 段動けば振り切る。
  //     放っておくと寄り道: 蝶 = 後ろへ飛ぶ蝶を追いかけて戻ってくる／葉・草の穂・落ち葉 = 前足で触る／魚屋 = 立ち止まって鼻を上げる。茜は待つ
  //   区間2 から: 距離とダッシュ（茜 20 px/秒・猫 18・ダッシュ 34。帯 28〜52。72 で茜が待つ、12 で追い抜く）
  //   区間3 から: 呼びかけ（行動ボタンが「なく」に変わる。2 秒以内に返事）
  //   三部構成: 導入 10 秒（静か・手本 1 つ）→ 中盤（出来事 6〜7 件。判断の後は 3 秒以上空け、途中に 6 秒の休み）→ 終盤 10 秒（静か。茜の小話）
  //   成績は川原で一度だけ: ぴったり = 3 区間を通して同じ道 75% 以上 ＋ 返事 3 回以上（寄り道しても戻れば可）。はっけんは行動の印（よりみち／おくれ／さきばしり／みちあんない／寄り道した相手）
  //   失敗も罰もない。スキップは ふつう（印なし）
  //   目標は一つ「お姉ちゃんと同じ道で、後ろを歩く」。障害は茜の道に出て茜が先によけて戻る（真似る）。誘惑は茜の道から 2 本離れた端にだけ出る（同じ道なら引かれない。見に行くのは選択）
  //   乱数は使わない（毎回同じ道順・同じ出来事。ユーザー決定）
  let walkMemo = { same: 0, walk: 0, replies: 0, detours: 0 };   // 3 区間を通した記録（区間1 の開始で消す）
  function walkGame(p) {
    const seg = Number(p.区間) || 1;
    const carried = !!p.だっこ;
    const gallery = p.gallery || '';
    const WALK_RESET = { よりみち: 'なし', よりみちさき: 'なし', 寄り道蝶: 'なし', 寄り道葉: 'なし', 寄り道草の穂: 'なし', 寄り道落ち葉: 'なし', 寄り道魚屋: 'なし', おくれ: 'なし', さきばしり: 'なし', みちあんない: 'なし' };   // 区間ごとの印（スキップ・だっこでは全部 なし に戻す）   // 確認用（?gallery=walk）: 物と誘惑を道に並べて止める。'zoom' は 3 倍の一覧
    const total = (Number(p.長さ) || 55) * 1000;
    if (seg === 1) walkMemo = { same: 0, walk: 0, replies: 0, detours: 0 };
    else if (E.state.さんぽきろく) { try { walkMemo = Object.assign({ same: 0, walk: 0, replies: 0, detours: 0 }, JSON.parse(E.state.さんぽきろく)); } catch (e) { /* 壊れていれば捨てる */ } }   // 保存から戻ったときのため
    const F = { dash: seg >= 2, calls: seg >= 3 };
    const V = { cat: 18, ak: 20, dash: 34 };
    let pausedTotal = 0, pausedSince = 0;
    const clock = () => Date.now() - pausedTotal;   // ゲーム内の時計。メニューを開いている間は進まない（Codex 第32回）
    const t0 = clock();
    let done = false, scroll = 0;
    const LANES = [124, 135, 147], CAT_X = 72, FLOOR = 140;
    // ── 画面 ──
    const title = el('div', 'title two', '');   // 題名と状況欄は 2 行ぶんの高さで固定（文の行数でボタンが動かないように）
    const status = el('div', 'prog', '');
    const skipBtn = button('スキップ', () => finish('ふつう', flags()), 'small');   // 残りを飛ばすだけ。ここまでの行動の印は残す
    const statusRow = el('div', 'status two'); statusRow.append(status);   // スキップは下の段（ボタンの間）へ。状況欄は幅いっぱい使う
    const bar = el('div', 'bar'); const fill = document.createElement('div'); fill.style.width = '0%'; bar.appendChild(fill);
    const bottom = el('div', 'row wide');
    ui.minigame.replaceChildren(title, statusRow, bar, bottom);
    let msgUntil = 0;
    const say = s => { status.textContent = s; };
    const log = [];
    let lastTalk = '', lastTalkAt = 0, retalk = '';   // 小話が読まれる前（1.5 秒以内）に操作の合図で上書きされたら、あとでもう一度流す
    const event = (s, ms) => { const now = clock(); if (lastTalk && now - lastTalkAt < 1500) retalk = lastTalk; lastTalk = ''; say(s); msgUntil = now + (ms || 1800); log.push(Math.round((now - t0) / 100) / 10 + 's ' + s); };
    const talk = s => { event(s, 3500); lastTalk = s; lastTalkAt = clock(); };
    function finish(grade, extra) {
      if (done) return;
      done = true; clearInterval(timer);
      endLater(300, 'せいこう', Object.assign({ さんぽ: grade }, extra || {}));
    }
    const up = el('button', 'big', '▲ おく'), down = el('button', 'big', '▼ てまえ');
    const act = el('button', 'big hold', 'ダッシュ'); const gauge = el('div', 'gauge'); act.appendChild(gauge);
    const meow = el('button', 'big', 'なく');   // 区間3: 返事はダッシュと別のボタン（兼用しない。ユーザー要望 2026-10-23）
    const left = el('div', 'col'), right = el('div', 'col');
    right.append(up, down);
    if (F.dash && !carried) left.appendChild(act);   // だっこ中はダッシュなし
    if (F.calls) left.appendChild(meow);
    if (carried) { left.appendChild(meow); bottom.append(left, skipBtn, el('div', 'col')); }   // だっこ: 鳴くだけ（何もしなくてもいい）
    else bottom.append(left, skipBtn, right);

    // ── 状態 ──
    let lane = 1, laneY = LANES[1], akLane = 1, akY = LANES[1];
    let d = F.dash ? 40 : 56, stamina = 1, dashing = false, needRelease = false, catSpeed = V.cat;
    let waiting = false, ahead = false, stopUntil = 0, fastUntil = 0, cooldownUntil = 0, smileUntil = 0, cueUntil = 0, nodUntil = 0, stumbleUntil = 0, zone = '';
    let detours = 0, waits = 0, overtakes = 0, replies = 0, waited = false, inBand = 0, lastDetour = '', sameT = 0, walkT = 0, offSince = 0;
    const visited = {};   // 寄り道した相手ごと（はっけんは「行ったことがあるか」で付ける）
    const passed = {};    // 見送った相手ごとの回数（同じ一言を繰り返さない）
    let callAt = 0, callUntil = 0, waitUntil = 0, beside = false;
    let leading = false, leadSince = 0, route = '';   // 区間2: 追い越して葵が先頭 → 分かれ道で池の道へ
    let path = [], wantLane = 1, akHits = 0;   // 案内中: 道しるべ（猫が道を替えた地点と道）、茜の希望道、茜が物に重なった回数（確認用）
    const items = [];   // { x, lane, kind, type: '物'|'誘', style: 'chase'|'touch'|'sniff', hit, over, seed, dy }
    let tempt = null, temptAt = 0, temptGap = 0;
    let playing = null, playUntil = 0, playStyle = '';
    let catX = CAT_X, chase = null;

    // ── 区間ごとの予定（秒）。arrive = 猫のところへ届く時刻。判断が終わってから 3 秒以上空ける ──
    const TALK = {
      1: ['茜「葵とな、この道でよう買い食いしてん」', '茜「あの家の犬、葵が怖がんねん。……吠えへんのに」', '茜「この塀の上、昔ネコがおってな。葵が毎日見に来とった」'],
      2: ['茜「ここのブランコ、葵と取り合いしてん」', '茜「秋はな、葵が落ち葉で栞作るねん」', '茜「水飲み場の水、冷たいんやで。葵、夏はここで顔洗う」'],
      3: ['茜「葵、ここのコロッケ好きやねん」', '茜「おばちゃん、葵にいっつもおまけしてくれんねん」', '茜「……この時間、店じまい早いなぁ」'],
    }[seg] || [];
    const talks = TALK.slice(0, 3);
    const CARRY_TALK = [{ t: 3, s: '茜「軽いなぁ。ちゃんと食べとるん？」' }, { t: 9, s: '茜「……あったかいな、あんた」' }, { t: 15, s: '茜「もうちょいで商店街や。じっとしとき」' }];   // だっこ（20 秒）
    const PLAN = {
      // 道: 0 = 奥, 1 = 中, 2 = 手前。障害（物）は茜の道に出す（茜が先によけて戻る）。誘惑は茜の道から 2 本離れた端に出す
      1: [ // 60 秒 = 導入 10 ＋ 中盤 40 ＋ 終盤 10。茜は 中 → 手前 → 奥
        // 物の t は猫に届く時刻。茜はその 4〜5 秒前によける（d=56 → 届く 86px 手前）ので、その時刻に他の出来事を置かない
        // 奥 = 家側（鉢植え・塀）、手前 = 道路側。物はその場所にあって自然な側に置く（Codex 第24回）
        { t: 3, type: 'talk' }, { t: 7, type: 'change', to: 0 },
        { t: 15, type: 'item', kind: 'みずたまり', style: '物', lane: 0 },   // よけ 10 秒ごろ。塀ぎわの水まきの跡
        { t: 19, type: 'item', kind: 'ちょう', style: 'chase', lane: 2 },   // 道路の上を飛ぶ
        { t: 25, type: 'glance' },
        { t: 28, type: 'item', kind: 'みずたまり', style: '物', lane: 0 },   // よけ 23 秒ごろ
        { t: 32, type: 'change', to: 2 },
        { t: 35, type: 'talk' },
        { t: 41, type: 'item', kind: 'はち', style: 'touch', lane: 0 },   // 家先の鉢植えから垂れた葉
        { t: 46, type: 'item', kind: 'ちょう', style: 'chase', lane: 0 },   // 塀の上を飛ぶ
        { t: 50, type: 'glance' },
        { t: 54, type: 'talk' },
      ],
      2: [ // 55 秒 = 10 ＋ 35 ＋ 10。茜は 手前 のまま
        { t: 3, type: 'talk' },
        { t: 12, type: 'fast', len: 3 },   // 案内中なら「追いつくでー」= 先頭を保つにはダッシュ
        { t: 19, type: 'item', kind: 'くさのほ', style: 'touch', lane: 0 },
        { t: 23, type: 'stop' },
        { t: 30, type: 'item', kind: 'こえだ', style: '物', lane: 2 },   // よけ 26 秒ごろ
        { t: 32, type: 'fork' },   // 分かれ道: 葵が先頭なら池の道
        { t: 34, type: 'talk' },
        { t: 37, type: 'glance' },
        { t: 40, type: 'item', kind: 'おちば', style: 'touch', lane: 0 },
        { t: 44, type: 'fast', len: 3 },
        { t: 48, type: 'stop' },
        { t: 51, type: 'talk' },
      ],
      3: [ // 55 秒 = 10 ＋ 35 ＋ 10。茜は 中 → 手前（店の前）。最後の呼びかけのあと 10 秒は並んで歩く
        { t: 4, type: 'call', s: 'そこ、おる？' },
        { t: 8, type: 'change', to: 2 },
        { t: 15, type: 'item', kind: 'あきかご', style: '物', lane: 2 },   // よけ 11 秒ごろ
        { t: 17, type: 'call', s: '段差、気ぃつけや' },
        { t: 22, type: 'item', kind: 'さかなや', style: 'sniff', lane: 0 },
        { t: 28, type: 'call', s: '……おなかすいたな' },
        { t: 31, type: 'talk' },
        { t: 35, type: 'item', kind: 'だんボール', style: '物', lane: 2 },   // よけ 31 秒ごろ（小話は忙しければ少し遅れる）
        { t: 38, type: 'call', s: 'もうちょいやで' },
        { t: 43, type: 'beside' },
        { t: 45, type: 'call', s: '……一緒に行こか' },
      ],
    }[seg] || [];
    if (seg === 2) { akLane = 2; lane = 2; laneY = akY = LANES[2]; }   // 公園は手前の道から
    if (gallery) {   // その区間の物と誘惑を、予定の道に 24 px おきに置く（動かさない）
      let gx = 140;
      for (const ev of PLAN) if (ev.type === 'item') { items.push({ x: gx, lane: ev.lane, kind: ev.kind, type: ev.style === '物' ? '物' : '誘', style: ev.style, seed: ev.t * 7, path: ev.style === '物' }); gx += 24; }
      title.textContent = `確認: 区間${seg} の物と誘惑`;
    }
    let talkI = 0;
    // 進行は時間ではなく「道のり」で数える: 予定の t 秒 = 通常の歩き（18 px/秒）で t 秒ぶん進んだ地点。
    // 寄り道や待ちで足が止まれば、その分あとの出来事も待つので、用意した要素は必ず全部通り過ぎてから区間が終わる
    const roadLen = (total / 1000) * V.cat;

    // ── 操作 ──
    const move = dir => {
      if (done || carried) return;
      const to = Math.max(0, Math.min(2, lane + dir));
      if (to === lane) return;
      lane = to;
      if (leading) path.push({ wx: scroll, lane: to });   // 案内中: 替えた地点を道しるべに（茜は同じ地点で替える＝猫がよけた物は茜もよけられる）
      if (tempt && Math.abs(tempt.lane - lane) > temptGap) { tempt.over = true; tempt = null; event(leading ? '……がまん。前を向く' : '……がまん。お姉ちゃんの方へ'); }   // 離れる方へ動いた = 振り切る（同じ道からでも 1 段でよい）
    };
    up.onpointerdown = e => { e.preventDefault(); move(-1); };
    down.onpointerdown = e => { e.preventDefault(); move(1); };
    const answer = () => {
      if (done || !callAt) return;
      const now = clock();
      replies++;
      if (now - callAt <= 1200) { smileUntil = now + 1000; event('にゃあ。……茜が、笑った'); }
      else { nodUntil = now + 800; event('にゃ。……茜が、うなずいた'); }
      callAt = 0; callUntil = 0;
    };
    act.onpointerdown = e => { e.preventDefault(); act.setPointerCapture(e.pointerId); dashing = true; };
    let meows = 0;
    const CARRY_REPLY = ['にゃー。……茜「はいはい」', 'にゃー。……茜「なんや、ご機嫌やな」', 'にゃー。……茜「落とさへんから、安心し」', 'にゃー。……茜「……うん。うちもや」'];
    const meowAct = () => {
      if (done) return;
      const now = clock();
      if (carried) { if (now > msgUntil) { event(CARRY_REPLY[Math.min(meows, CARRY_REPLY.length - 1)], 1800); meows++; } }   // だっこ中: 鳴くたびに茜が返す（4 回目からは同じ）
      else if (callAt) answer();
      else if (now > msgUntil) event('にゃ。……茜「ん？ どないしたん」', 1500);   // 呼ばれていないときに鳴いても、何も起きない（茜が振り向くだけ）
    };
    meow.onpointerdown = e => { e.preventDefault(); meowAct(); };
    act.onpointerup = act.onpointercancel = () => { dashing = false; needRelease = false; };

    title.textContent = carried ? '腕の中。何もしなくていい。鳴いてもいい（なく）'
      : seg === 1 ? '住宅街。目標: お姉ちゃんと同じ道で、後ろを歩く（▲▼）'
      : seg === 2 ? '公園。目標: 同じ道を歩く。ダッシュで先頭にもなれる'
      : '商店街。目標: 同じ道で、呼ばれたら「なく」';
    say(carried ? 'お姉ちゃんの腕の中。ゆられている' : seg === 1 ? '足元の物は、お姉ちゃんの真似でよける。端の物は、見に行ってもいい' : seg === 2 ? '離れたら「ダッシュ」。近づいたら、ダッシュを離す' : '呼ばれたら「なく」で返事（PC は Enter）');

    // ── 毎フレーム ──
    const view = {};
    function startPlay(it, when) {
      detours++; lane = it.lane; tempt = null; lastDetour = it.kind; visited[it.kind] = true;
      if (it.style === 'chase') {
        chase = { it, phase: 'lead', until: when + 1500 }; it.dy = 0;
        event('……蝶が後ろへ。足が勝手に。茜「こら、そっちちゃう」', 2500);   // 状況欄は横長で 1 行 16 字ほど。2 行（32 字）に収める
      } else {
        playing = it; playUntil = when + 1500; playStyle = it.style; it.hit = true;
        event(it.kind === 'はち' ? '……葉っぱを、前足でぽん。……鼻先をくすぐられました' : it.kind === 'くさのほ' ? '……鼻先で、ふわ。……くしゅん' : it.kind === 'おちば' ? '……転がる葉を、前足で押さえました。……また逃げた' : '……魚屋さんの前で、鼻が勝手に上を向きます', 2500);
      }
    }
    // 案内中の茜の道。優先順位は 安全 → 道しるべ → 今の道（Codex 第26回で合意）。
    //   道しるべ: 猫が道を替えた世界座標。茜（scroll + d）がそこに着いたら、その道が希望道になる（物は世界に固定なので、猫がよけた物は茜も同じ地点でよけられる）
    //   替え先の 30 px 以内に物があれば保留して今の道を歩く。今の道に物があるときは、予定の道替えで間に合うならそれを待ち、間に合わなければ安全な隣へ自分でよける
    function followPath(now) {
      const akX = CAT_X + d, akW = scroll + d;
      while (path.length && path[0].wx <= akW) { wantLane = path[0].lane; path.shift(); }
      const ahead = ln => items.find(it => it.path && it.lane === ln && it.x + 12 > akX - 6 && it.x < akX + 30);
      let cand = wantLane;
      if (cand !== akLane && ahead(cand)) cand = akLane;
      const ob = ahead(cand);
      if (ob) {
        const next = path[0];
        const planned = next && next.lane !== cand && !ahead(next.lane) && next.wx - akW < ob.x - akX - 10;   // 予定の道替えが物の 10 px 以上手前にある
        if (!planned) {
          const alts = [cand - 1, cand + 1].filter(l => l >= 0 && l <= 2 && !ahead(l)).sort((a, b) => Math.abs(a - wantLane) - Math.abs(b - wantLane));
          if (alts.length) { cand = alts[0]; if (!ob.akDodged) { ob.akDodged = true; cueUntil = now + 800; if (now > msgUntil) event('茜「よいしょ」（案内中によけた）'); else log.push(Math.round((now - t0) / 100) / 10 + 's 茜「よいしょ」（案内中によけた。表示は「大丈夫かー？」のまま）'); } }
        }
      }
      if (cand !== akLane) log.push(Math.round((now - t0) / 100) / 10 + 's （茜が道を替えた → ' + cand + '）');
      akLane = cand;
      for (const it of items) if (it.path && it.lane === akLane && !it.akHit && Math.abs(akY - LANES[akLane]) < 4 && it.x < akX + 5 && it.x + 12 > akX - 5) { it.akHit = true; akHits++; log.push(Math.round((now - t0) / 100) / 10 + 's （茜が物に重なった: ' + it.kind + '）'); }
    }
    function tick(t, dt, now) {
      if (carried) {
        scroll += 40 * dt;
        for (const c of CARRY_TALK) if (!c.done && t >= c.t * 1000 && now > msgUntil) { c.done = true; event(c.s, 3000); }
        if (BOT && BOT !== 'idle' && !view.meowed && t > 5000 && now > msgUntil) { view.meowed = true; meowAct(); }   // bot: 一度だけ鳴く
        return;
      }
      const T = scroll / V.cat;   // 「道のりの時刻」。止まっている間は進まない
      const busy = !!tempt || !!playing || !!chase || !!callAt || now < stumbleUntil;
      // 予定（小話・振り返り・呼びかけは、前の表示が読まれてから。操作の合図＝道替え・よけ・速足などは待たない）
      if (retalk && !busy && now > msgUntil) { const s2 = retalk; retalk = ''; talk(s2); }
      for (const ev of PLAN) {
        if (ev.done) continue;
        if (ev.type === 'item') {
          const lead = (ev.t - T) * V.cat;
          if (lead > 198) continue;
          ev.done = true;
          const isTempt = ev.style !== '物';
          items.push({ x: CAT_X + Math.max(0, lead), lane: ev.lane, kind: ev.kind, type: isTempt ? '誘' : '物', style: ev.style, seed: ev.t * 7, path: !isTempt });
          continue;
        }
        if (T < ev.t) continue;
        if ((ev.type === 'talk' || ev.type === 'glance' || ev.type === 'call') && (busy || now < msgUntil || retalk)) continue;   // 判断中・表示中には流さない（少し遅らせる）
        ev.done = true;
        if (ev.type === 'change') { if (!leading) akLane = ev.to; cueUntil = now + 1200; event('茜「こっちの道、行こか」'); }
        else if (ev.type === 'talk') { if (talkI < talks.length) talk(talks[talkI++]); }
        else if (ev.type === 'fast') { fastUntil = now + ev.len * 1000; event(leading ? '茜「追いつくでー」　先頭を保つなら「ダッシュ」' : '茜の足が、少し速くなった', leading ? 2500 : 1800); }
        else if (ev.type === 'stop') { stopUntil = now + 1000; cueUntil = now + 1000; if (!waiting) event(leading ? '茜「あ、靴ひも。……先行っとって」' : '茜が、立ち止まって振り返った'); }
        else if (ev.type === 'call') { callAt = now; callUntil = now + 2000; event(`茜「${ev.s}」`, 2000); }
        else if (ev.type === 'beside') { beside = true; cueUntil = now + 1000; event('茜が、歩幅をゆるめた。……隣に並べる', 2500); }
        else if (ev.type === 'glance') { cueUntil = now + 900; if (leading) { smileUntil = now + 1000; event('後ろから、茜が笑った'); } else if (lane === akLane) { smileUntil = now + 1000; event('茜が振り返って、笑った'); } else event('茜が振り返って、自分の道を指さした'); }
        else if (ev.type === 'fork') { if (leading) { route = 'いけ'; event('茜「……池の道？ ええよ。こっち、久しぶりや」', 3000); } else event('茜「池の道もあるけど、今日はこっちな」', 2500); }
      }
      if (callAt && now > callUntil) { callAt = 0; callUntil = 0; waited = true; waitUntil = now + 1200; event('茜「……おるな」（足元を確かめた）', 2000); }
      meow.classList.toggle('glow', !!callAt);   // 呼ばれている間だけ「なく」が光る

      // 速度
      if (BOT && !carried) {
        const bot = view;   // 直前の入力時刻を置く
        const nearTempt = items.find(it => it.type === '誘' && !it.hit && !it.over && it.x > CAT_X - 8 && it.x < CAT_X + 80);
        const can = now - (bot.moveAt || 0) > 400;
        if (BOT === 'curious' && nearTempt && !tempt && !playing && !chase) { if (lane !== nearTempt.lane && can) { move(Math.sign(nearTempt.lane - lane)); bot.moveAt = now; } }
        else if ((BOT === 'follow' || (BOT === 'lead' && leading)) && tempt && can) { move(Math.sign(lane - tempt.lane) || (lane === 0 ? 1 : -1)); bot.moveAt = now; }
        else if (BOT === 'leadlate' && leading && can && items.some(it => it.type === '物' && !it.hit && it.lane === lane && it.x > CAT_X - 4 && it.x < CAT_X + 22)) { bot.retLane = lane; move(lane === 2 ? -1 : 1); bot.moveAt = now; }
        else if (BOT === 'leadlate' && leading && can && bot.retLane != null && !items.some(it => it.type === '物' && it.lane === bot.retLane && it.x > CAT_X - 20 && it.x < CAT_X + 22)) { move(Math.sign(bot.retLane - lane)); bot.moveAt = now; bot.retLane = null; }
        else if (BOT !== 'idle' && BOT !== 'leadlate' && BOT !== 'leadclumsy' && leading && can && items.some(it => it.type === '物' && !it.hit && it.lane === lane && it.x > CAT_X - 4 && it.x < CAT_X + 50)) { move(lane === 2 ? -1 : 1); bot.moveAt = now; }
        else if (BOT !== 'idle' && !leading && lane !== akLane && !chase && !playing && !tempt && can) { move(Math.sign(akLane - lane)); bot.moveAt = now; }
        if (F.dash) {
          if (BOT === 'lead') dashing = T < 4 || (leading && d > -20) || (!leading && d > 52);
          else if (BOT === 'lazylead') dashing = T < 4 || (!leading && d > 52);
          else if (BOT === 'leadlate' || BOT === 'leadclumsy') dashing = T < 4 || (leading && d > -20) || (!leading && d > 52);   // leadclumsy: 案内中に物をよけない（茜が自分でよけるかの確認）
          else if (BOT === 'follow' || BOT === 'curious') dashing = !leading && d > 50;
          else dashing = false;
          if (callAt) { dashing = false; needRelease = false; }
          if (callAt && BOT !== 'idle' && now - callAt > (BOT === 'follow' ? 400 : 1500)) answer();
        }
      }
      const canDash = F.dash && dashing && stamina > 0 && !ahead && !playing && !chase && !callAt;
      if (canDash) { stamina = Math.max(0, stamina - dt / 2); catSpeed = V.dash; }
      else { if (!dashing) stamina = Math.min(1, stamina + dt / 2.5); catSpeed = V.cat; }
      gauge.style.width = (stamina * 100) + '%';
      const stumbling = now < stumbleUntil;
      if (stumbling) catSpeed = Math.min(catSpeed, 10);

      if (playing && now >= playUntil) { playing.over = true; playing = null; }
      // 茜が足元の障害をよけて、通り過ぎたら元の道へ戻る（手本）
      for (const it of items) {
        if (!it.path || it.akBack || leading) continue;   // 案内中は followPath() が決める
        const akX = CAT_X + d;
        if (!it.akDodged && it.lane === akLane && it.x - akX <= 30) { it.akDodged = true; it.akOrig = akLane; akLane = akLane === 1 ? 0 : 1; cueUntil = now + 1000; event('茜「よいしょ」（よけた）'); }
        else if (it.akDodged && it.x + 12 < CAT_X - 8) { it.akBack = true; akLane = it.akOrig; cueUntil = now + 800; }   // 猫も通り過ぎてから戻る
      }
      // 障害と誘惑
      for (const it of items) {
        if (it.hit || it.over) continue;
        const gap = Math.abs(it.lane - lane);
        if (it.type === '物') {
          if (gap === 0 && Math.abs(laneY - LANES[it.lane]) < 4 && it.x < CAT_X + 7 && it.x + 12 > CAT_X - 7) { it.hit = true; stumbleUntil = now + 500; event(it.kind === 'みずたまり' ? '……片足、ぷるっ。茜「濡れたか？」' : '茜「大丈夫かー？」'); }
          continue;
        }
        it.near = !playing && !chase && gap <= 1 && it.x > CAT_X - 8 && it.x < CAT_X + 60;
        if (!tempt && !playing && !chase && gap === 0 && it.x < CAT_X + 10 && it.x > CAT_X - 8) { it.hit = true; startPlay(it, now); continue; }   // 自分から踏み込んだ = 見に行く
        if (!tempt && !playing && !chase && gap === 1 && it.x - CAT_X <= 36 && it.x > CAT_X - 8) {
          tempt = it; temptAt = now; temptGap = gap;
          event(leading ? '……気になる。離れる方へ動けば、がまんできる' : '……気になる。お姉ちゃんの道へ戻れば、がまんできる', 2200);
        }
      }
      if (tempt) {
        if (tempt.x < CAT_X - 20) { tempt.over = true; tempt = null; event('……通り過ぎました。がまん、できた', 1500); }
        else if (now - temptAt >= 2000) startPlay(tempt, now);
      }
      for (const it of items) {   // 寄らずに見送った誘惑
        if (it.type !== '誘' || it.hit || it.over || it.x >= CAT_X - 10) continue;
        it.over = true;
        passed[it.kind] = (passed[it.kind] || 0) + 1;
        if (!tempt && !playing && !chase && !callAt) event(passed[it.kind] > 1 && it.kind === 'ちょう' ? '……また蝶々。塀の向こうへ飛んでいきました' : PASS_LINE[it.kind] || '', 1500);
      }
      if (playing) catSpeed = 0;
      if (chase) {   // 蝶の追いかけ: 背景も茜も止まり、猫だけ後ろへ走って、蝶が飛び去ったら戻ってくる
        catSpeed = 0;
        const it = chase.it;
        if (chase.phase === 'lead') {
          it.x -= 30 * dt; it.dy -= 3 * dt;
          catX += ((it.x + 2) - catX) * Math.min(1, dt * 4);
          if (catX < 14) catX = 14;
          if (now >= chase.until) { chase.phase = 'leave'; chase.until = now + 1300; event('……あ。飛んでいってしまいました', 1300); }
        } else if (chase.phase === 'leave') {
          it.x -= 8 * dt; it.dy -= 50 * dt;
          if (now >= chase.until) { it.over = true; it.hit = true; chase.phase = 'return'; chase.until = now + 1600; event('茜「……戻っといで。待ったるから」', 1600); }
        } else {
          catX += (CAT_X - catX) * Math.min(1, dt * 5);
          if (now >= chase.until) { catX = CAT_X; chase = null; event('茜「ほな、行こか」'); }
        }
      }

      laneY += (LANES[lane] - laneY) * 0.3;
      akY += (LANES[akLane] - akY) * 0.2;
      view.lean = tempt && now - temptAt >= 800 ? Math.sign(LANES[tempt.lane] - LANES[lane]) * 3 : 0;

      // 距離
      const tempting = !!tempt || !!playing || !!chase;
      let akSpeed;
      if (!F.dash) akSpeed = catSpeed;
      else if (tempting || callAt) akSpeed = catSpeed;
      else if (leading) akSpeed = now < stopUntil ? 0 : now < fastUntil ? 25 : V.ak;   // 案内中も速足・立ち止まりは効く（放っておくと追いつかれる）
      else akSpeed = waiting || now < waitUntil ? 0 : ahead ? 30 : now < stopUntil ? 0 : now < fastUntil ? 25 : V.ak;
      if (F.dash && stumbling && !tempting && !waiting) akSpeed = Math.min(akSpeed, 12);
      if (F.dash && !canDash && !leading && !ahead && !tempting && !callAt && d <= 12 && catSpeed > akSpeed) catSpeed = akSpeed;   // 歩きで追いつく＝歩幅を合わせる（追い越しはダッシュだけ）
      d += (akSpeed - catSpeed) * dt;
      if (beside && !waiting && !tempting && !ahead) d += (20 - d) * Math.min(1, dt * 1.5);
      if (leading) { d = Math.max(-40, d); followPath(now); }
      if (now < waitUntil) d = Math.max(16, d);
      if (!F.dash) d = 56;
      scroll += catSpeed * dt;
      for (const it of items) it.x -= catSpeed * dt;
      while (items.length && items[0].x < -24) items.shift();

      const calm = T > total / 1000 - 10 || beside;   // 終盤は歩幅を合わせ、距離の採点も休む
      const walkingNow = !tempting && !callAt && !waiting && !ahead && now >= waitUntil && !stumbling && !calm && catSpeed > 0;
      const safeDev = leading && akLane !== wantLane;   // 案内中、茜が安全のためにずれている間（自分でよけた／保留）は採点しない（Codex 第27回: 二重の罰にしない）
      if (walkingNow && !safeDev) { walkT += dt; if (leading || lane === akLane) sameT += dt; }   // 案内中は道しるべどおり＝同じ道（追従の遅れは数えない）
      if (lane !== akLane) { if (!offSince) offSince = now; } else offSince = 0;
      if (offSince && now - offSince > 2500 && now > msgUntil && !tempting && !callAt) { say('お姉ちゃんと同じ道へ（▲▼）'); msgUntil = now + 2000; }
      if (F.dash && !tempting && !callAt) {
        if (!waiting && !ahead && now >= cooldownUntil && d >= 72) { waiting = true; waits++; cueUntil = now + 1200; event('茜「はよおいで。待ったるから」', 2500); }
        if (waiting && d <= 44) { waiting = false; cooldownUntil = now + 6000; event('茜「ほな、行こか」'); }
        if (!ahead && !leading && now >= cooldownUntil && d <= 12 && canDash) {
          overtakes++; smileUntil = now + 1200;
          if (!F.calls) { leading = true; leadSince = now; d = -24; path = [{ wx: scroll, lane }]; wantLane = akLane; event('茜「先行くん？ ……ほな、案内して」', 2500); }
          else { d = -16; ahead = true; event('茜「こら、先行ったらあかん！ ……元気やなぁ」', 2500); }
        }
        if (ahead && d >= 32) { ahead = false; cooldownUntil = now + 2000; }
        if (leading && d >= 8) { leading = false; path = []; cooldownUntil = now + 2500; event('茜「ほな、うちが前な」'); }   // 葵が遅れたら茜がまた先頭に
        const cool = now < cooldownUntil;
        if (!waiting && !ahead && !cool && now >= waitUntil && !calm && d >= 28 && d <= 52) inBand += dt;
        if (now > msgUntil && !waiting && !ahead && !calm) {
          const z = leading ? (d > -12 ? 'lnear' : 'lead') : d > 60 ? 'far' : d < 22 ? 'near' : (d >= 28 && d <= 52) ? 'band' : zone;
          if (z !== zone) { zone = z; say(z === 'lead' ? '今は、私が道案内。歩くだけだと、追いつかれる' : z === 'lnear' ? '追いつかれそう。先頭を保つなら「ダッシュ」' : z === 'far' ? '少し離れてきた。「ダッシュ」' : z === 'near' ? '近づきすぎ。ダッシュを離す' : 'このくらいの距離で歩こう'); }
        }
      }
      view.now = now; view.T = T; view.akLane = akLane; view.off = lane !== akLane && !tempting; view.stumbling = stumbling; view.smile = now < smileUntil; view.cue = now < cueUntil || !!callAt; view.nod = now < nodUntil;
      view.pull = !!tempt; view.play = !!playing; view.playStyle = playStyle; view.chase = !!chase; view.catX = catX; view.near = items.some(it => it.near && !it.hit && !it.over);
    }
    function grade() {
      if (carried) return 'だっこ';
      if (seg < 3) return 'ふつう';
      const m = walkMemo;
      return m.replies >= 3 && m.walk > 0 && m.same / m.walk >= 0.75 ? 'ぴったり' : 'ふつう';   // finalize() のあとに呼ぶ
    }
    const KIND_NAME = { ちょう: '蝶', はち: '葉', くさのほ: '草の穂', おちば: '落ち葉', さかなや: '魚屋' };
    const PASS_LINE = { ちょう: '……蝶々。今日は、お姉ちゃんの道', はち: '……葉っぱが揺れてる。見送ります', くさのほ: '……草の穂。くしゃみ、出そう',おちば: '……落ち葉が、転がっていきました', さかなや: '……お魚のにおい。がまん、がまん' };
    const flags = () => (carried ? Object.assign({}, WALK_RESET, { よりみちけい: walkMemo.detours ? 'した' : 'なし', なきごえ: meows ? 'あり' : 'なし' }) : {
      よりみち: detours ? 'した' : 'なし', よりみちさき: detours ? (KIND_NAME[lastDetour] || 'なし') : 'なし',
      寄り道蝶: visited.ちょう ? 'した' : 'なし', 寄り道葉: visited.はち ? 'した' : 'なし', 寄り道草の穂: visited.くさのほ ? 'した' : 'なし', 寄り道落ち葉: visited.おちば ? 'した' : 'なし', 寄り道魚屋: visited.さかなや ? 'した' : 'なし',
      よりみちけい: walkMemo.detours ? 'した' : 'なし',   // 3 区間を通して寄り道があったか（finalize のあと）
      おくれ: (waits || waited) ? 'した' : 'なし', さきばしり: overtakes && route !== 'いけ' ? 'した' : 'なし', みちあんない: route === 'いけ' ? 'した' : 'なし',
    });
    function finalize() { walkMemo.same += sameT; walkMemo.walk += walkT; walkMemo.replies += replies; walkMemo.detours += detours; E.state.さんぽきろく = JSON.stringify(walkMemo); }   // 状態に入れて保存に載せる

    // ── 絵 ──
    const pix = (rows, x0, y0, pal) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') rect(x0 + i, y0 + j, 1, 1, pal[r[i]]); });   // 1 文字 = 1 px
    const BUTTERFLY = [   // Codex 第24回の図。K = 縁、Y = 羽。開く／半分の 2 コマ
      ['.KK..KK.', 'KYYKKYYK', 'KYYKKYYK', '.KYKKYK.', '..KYYK..', '...KK...'],
      ['..K..K..', '.KYKKYK.', '.KYKKYK.', '..KYYK..', '...KK...', '...KK...'],
    ];
    const EAR = ['...P...', '...P...', '..PPP..', '..PPP..', '...P...', '...G...', '...G.G.', '.G.GD..', '..GG...', '...D...'];   // 草の穂 1 本（先細り）
    const LEAF = ['...OO.', '..OOO.', '.OOBO.', '..OB..', '.B....'];   // 斜めの葉身＋葉柄
    const drawItem = it => {
      const x = Math.round(it.x), y = (it.y != null ? it.y : LANES[it.lane]) + Math.round(it.dy || 0), ph = Math.floor((clock() / 100 + (it.seed || 0))) % 2;
      switch (it.kind) {
        case 'みずたまり':   // 楕円の水たまり（上下 1 段ずつ細く）＋ハイライト
          rect(x + 2, y - 3, 8, 1, '#5a8ac8'); rect(x, y - 2, 12, 1, '#5a8ac8'); rect(x + 2, y - 1, 8, 1, '#5a8ac8'); rect(x + 3, y - 3, 4, 1, '#a0c8f0'); break;
        case 'こえだ':   // 根元が太い小枝。枝分かれ 2 本
          rect(x, y - 2, 10, 1, '#6a4020'); rect(x, y - 3, 3, 1, '#6a4020'); rect(x + 6, y - 4, 1, 2, '#6a4020'); rect(x + 8, y - 3, 1, 1, '#6a4020'); break;
        case 'あきかご':   // 店の空きかご: 取っ手の弧＋台形＋編み目
          rect(x + 3, y - 9, 4, 1, '#c8a060'); rect(x + 2, y - 8, 1, 1, '#c8a060'); rect(x + 7, y - 8, 1, 1, '#c8a060');
          rect(x, y - 7, 10, 1, '#a07838'); rect(x, y - 6, 10, 4, '#c8a060'); rect(x + 1, y - 2, 8, 1, '#a07838');
          for (let i = 0; i < 5; i++) { rect(x + 1 + i * 2, y - 5, 1, 1, '#a07838'); rect(x + 2 + i * 2, y - 4, 1, 1, '#a07838'); } break;
        case 'だんボール':   // 段ボール箱: 上のふたの線＋中央のテープ
          rect(x, y - 7, 11, 7, '#c8a878'); rect(x + 1, y - 6, 9, 1, '#a08050'); rect(x + 5, y - 7, 1, 7, '#a08050'); break;
        case 'ちょう': pix(BUTTERFLY[Math.floor(clock() / 160 + (it.seed || 0)) % 2], x, y - 16, { K: C.black, Y: C.yellow }); break;   // 黄色い蝶＋縁取り。0.16 秒ごとに羽ばたく
        case 'はち':   // 鉢植え（縁あり）から垂れた葉
          rect(x + 2, y - 5, 6, 5, '#a05030'); rect(x + 1, y - 5, 8, 1, '#c06040'); rect(x + 1, y - 8, 8, 3, '#3a7a30'); rect(x + 8 + ph, y - 6, 3, 1, '#5a9a40'); rect(x + 10 + ph, y - 5, 2, 1, '#5a9a40'); break;
        case 'くさのほ': pix(EAR, x - 1 + ph, y - 10, { P: '#d8c890', G: '#8aa050', D: '#5a7a30' }); break;   // 先細りの穂が揺れる
        case 'おちば': pix(LEAF, x, y - 5 + ph, { O: '#d08030', B: '#805030' }); break;   // 転がる
        case 'さかなや':   // 店先の台: 木の台＋氷＋銀の魚 2 匹＋におい
          rect(x + 1, y - 5, 1, 5, '#8a6a40'); rect(x + 12, y - 5, 1, 5, '#8a6a40'); rect(x, y - 6, 14, 1, '#b08050'); rect(x + 1, y - 7, 12, 1, C.blue);
          rect(x + 1, y - 9, 4, 2, C.white); rect(x + 6, y - 10, 1, 1, C.white); rect(x + 6, y - 8, 1, 1, C.white); rect(x + 5, y - 9, 1, 1, C.white); rect(x + 1, y - 9, 1, 1, C.black);
          rect(x + 7, y - 9, 4, 2, C.white); rect(x + 12, y - 10, 1, 1, C.white); rect(x + 12, y - 8, 1, 1, C.white); rect(x + 11, y - 9, 1, 1, C.white); rect(x + 7, y - 9, 1, 1, C.black);
          rect(x + 4 + ph, y - 13, 1, 2, '#c8c8d0'); rect(x + 8 - ph, y - 14, 1, 2, '#c8c8d0'); break;   // 店先の台と、におい
      }
    };
    function draw() {
      if (gallery === 'zoom') {   // 確認用: 全部の物と誘惑を 3 倍で並べる（右下の猫は大きさの比較）
        cx.save(); cx.scale(3, 3); rect(0, 0, 86, 54, seg === 2 ? '#4a8a40' : '#8a8a90');
        ['みずたまり', 'こえだ', 'あきかご', 'だんボール', 'ちょう', 'はち', 'くさのほ', 'おちば', 'さかなや'].forEach((kind, i) => drawItem({ x: 3 + (i % 4) * 21, y: 16 + Math.floor(i / 4) * 18, lane: 1, kind, seed: i }));
        drawSprite('cat_sit', 50, 52); cx.restore(); return;
      }
      const dusk = seg === 3 ? Math.min(1, (view.T || 0) / (total / 1000)) : 0;
      drawSky(false);
      if (dusk) rect(0, 0, 256, 120, `rgba(20,16,48,${0.35 * dusk})`);   // 商店街は少しずつ暮れる
      const park = seg === 2;
      const shades = park ? ['#3e7a36', '#4a8a40', '#56984a'] : ['#7a7a82', '#8a8a90', '#9a9aa0'];
      rect(0, 118, 256, 12, shades[0]); rect(0, 130, 256, 11, shades[1]); rect(0, 141, 256, 19, shades[2]);
      for (let x = -(scroll % 24); x < 256; x += 24) { rect(x, 129, 6, 1, park ? '#6aa860' : '#b0b0b8'); rect(x + 12, 140, 6, 1, park ? '#6aa860' : '#b0b0b8'); }
      // 遠景と、生活感（判定に関係しない。世界の座標に置く）
      const far = scroll * 0.5;
      for (let x = -(far % 48); x < 256; x += 48) {
        if (seg === 1) { rect(x, 100, 4, 18, '#a08060'); rect(x, 100, 48, 2, '#a08060'); }
        else if (seg === 2 && route === 'いけ') { rect(x, 96, 48, 22, '#3868a8'); rect(x + 6, 104, 10, 1, '#78b0e0'); rect(x + 30, 110, 8, 1, '#78b0e0'); rect(x + 20, 86, 1, 12, '#8aa050'); rect(x + 23, 84, 1, 14, '#8aa050'); }   // 池と葦
        else if (seg === 2) { rect(x + 10, 92, 6, 26, '#6a4020'); rect(x, 64, 26, 32, '#3a7a30'); }
        else {
          const lit = dusk > 0.6 && Math.floor((x + far) / 48) % 2 === 0;
          rect(x, 50, 40, 68, '#d8c8b0'); rect(x + 2, 64, 36, 8, C.sofa); rect(x + 14, 90, 12, 28, lit ? C.yellow : '#504030');
          if (dusk > 0.6) rect(x + 4, 76, 8, 6, lit ? '#f8f0a0' : '#504030');
        }
      }
      const wx = X => Math.round(X - far);   // 遠景の世界座標 → 画面
      if (seg === 1) {
        if (far < 420) { const x = wx(300); rect(x, 92, 10, 12, C.white); rect(x + 12, 92, 10, 12, '#a8d8f8'); }   // 物干しのタオル（途中で取り込まれる）
        { const x = wx(760); rect(x, 108, 14, 8, '#8a6a40'); rect(x + 2, 104, 4, 4, '#8a6a40'); rect(x + 4, 106, 1, 1, C.black); }   // 門の内側の犬
      } else if (seg === 2) {
        { const x = wx(520); rect(x, 100, 8, 18, C.gray); rect(x + 2, 96, 4, 4, C.gray); rect(x + 3, 118, 2, 1, '#78b0e0'); }   // 水飲み場
        { const x = wx(1000); rect(x, 104, 6, 12, '#f0c090'); rect(x + 1, 100, 4, 4, '#604020'); rect(x + 7, 110, 4, 4, C.sofa); }   // 遠くの子どもとボール
      }
      const bob = Math.floor(scroll / 8) % 2, now = view.now || clock();
      const cx0 = Math.round(view.catX || CAT_X);
      const layers = items.filter(it => !(it.over && it.kind === 'ちょう' && (it.dy || 0) < -60)).map(it => ({ y: LANES[it.lane], f: () => drawItem(it) }));
      const ax = Math.round(CAT_X + d), ay = Math.round(akY);
      layers.push({ y: akY + (d < 0 ? -0.2 : 0.2), f: () => {
        drawSprite(humanSprite('akane_stand'), ax, ay - (view.nod ? 1 : bob));
        if (carried) drawSprite('cat_sit', ax + 6, ay - 12 - bob);
        if (view.cue) { rect(ax - 1, ay - 42, 2, 5, C.white); rect(ax - 1, ay - 36, 2, 2, C.white); }
        if (view.smile) drawHeart(ax + 10, ay - 40);
      } });
      if (!carried) layers.push({ y: laneY + 0.1, f: () => {
        const cy = Math.round(laneY) + (view.lean || 0);
        const chaseBob = view.chase ? Math.floor(now / 90) % 2 : bob;
        if (!(view.stumbling && Math.floor(now / 80) % 2)) drawSprite('cat_sit', cx0, cy - (view.play ? 0 : chaseBob));
        if (view.play && view.playStyle === 'sniff') { rect(cx0 + 10, cy - 22, 1, 2, C.white); rect(cx0 + 12, cy - 24, 1, 2, C.white); }   // 鼻を上げている
        else if (view.play || view.chase) { rect(cx0 - 1, cy - 24, 2, 4, C.yellow); rect(cx0 - 1, cy - 19, 2, 1, C.yellow); }   // 「！」= 夢中
        else if (view.pull || view.near) { rect(cx0 - 2, cy - 24, 4, 1, C.white); rect(cx0 + 1, cy - 23, 1, 2, C.white); rect(cx0, cy - 21, 1, 1, C.white); rect(cx0, cy - 19, 1, 1, C.white); }   // 「？」= 気になる
      } });
      layers.sort((a, b) => a.y - b.y).forEach(l => l.f());
      if (view.off && !carried) { const gy = LANES[view.akLane] - 1; for (let i = 0; i < 3; i++) rect(cx0 + 14 + i * 6, gy, 3, 1, C.white); }   // 「お姉ちゃんの道はここ」
    }

    let last = clock();
    const timer = setInterval(() => {
      if (!ui.menu.classList.contains('hidden')) { if (!pausedSince) pausedSince = Date.now(); return; }   // メニュー中は一時停止
      if (pausedSince) { pausedTotal += Date.now() - pausedSince; pausedSince = 0; }
      const now = clock(), t = now - t0, dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (gallery) { render(); return; }
      tick(t, dt, now);
      const progress = carried ? t / total : scroll / roadLen;   // 道のりで進む（だっこは何も起きないので時間で）
      fill.style.width = Math.min(100, progress * 100) + '%';
      render();
      if (progress >= 1 && !tempt && !playing && !chase && !callAt) {   // 途中の出来事が片付いてから終わる
        finalize();
        dlog({ 区間: seg, 秒: Math.round(t / 100) / 10, 成績: grade(), 印: flags(), 同じ道: Math.round(100 * (walkT ? sameT / walkT : 0)) + '%', 寄り道: detours, 待ち: waits, 追い越し: overtakes, 返事: replies, 道: route || '', 茜接触: akHits, 出来事: log });
        finish(grade(), flags());
      }
    }, 33);
    game = {
      stop: () => clearInterval(timer),
      key: e => {
        if (e.key === 'ArrowUp' || e.key === 'w') move(-1);
        else if (e.key === 'ArrowDown' || e.key === 's') move(1);
        else if (F.dash && e.key === ' ' && !e.repeat) dashing = true;
        else if ((F.calls || carried) && e.key === 'Enter' && !e.repeat) meowAct();
      },
      keyup: e => { if (e.key === ' ') { dashing = false; needRelease = false; } },
      draw,
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
    const finish = r => { if (done) return; done = true; endLater(700, r); };
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
    let count = 0, started = 0, timer = null, holdTimer = null, done = false, pausedAt = 0;
    const prog = el('div', 'prog', `0 / ${target}`);
    const bar = el('div', 'bar'); const fill = document.createElement('div'); fill.style.width = '100%'; bar.appendChild(fill);
    const btn = el('button', 'big', 'ふむ！');
    ui.minigame.replaceChildren(el('div', 'title', 'キーボードをふめ！（連打でも長押しでも。PCはどのキーでも）'), prog, bar, btn);
    const finish = ok => {
      if (done) return;
      done = true; clearInterval(timer); clearInterval(holdTimer);
      endLater(500, ok ? 'せいこう' : 'しっぱい');
    };
    const tick = () => {
      if (!ui.menu.classList.contains('hidden')) { if (!pausedAt) pausedAt = Date.now(); return; }   // メニュー中は止まる
      if (pausedAt) { started += Date.now() - pausedAt; pausedAt = 0; }
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
    game = { key: () => press(), stop: () => { done = true; clearInterval(timer); clearInterval(holdTimer); } };
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
        endLater(600, 'せいこう');
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
      stop: () => { done = true; clearInterval(loop); },
    };
    drawDial();
  }

  // ---------- 入力 ----------
  ui.dialog.addEventListener('click', advance);
  ui.stage.addEventListener('click', advance);
  document.addEventListener('keydown', e => {
    if (!ui.menu.classList.contains('hidden')) { if (e.key === 'Escape' && !pickerOpen) closeMenu(); return; }
    if (game && game.key) { game.key(e); e.preventDefault(); return; }
    if (mode === 'dialog' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); }
    else if (mode === 'commands' && /^[1-9]$/.test(e.key)) { const b = ui.commands.querySelectorAll('button')[Number(e.key) - 1]; if (b) b.click(); }
    else if (mode === 'commands' && e.key === 'Escape') openMenu();
  });
  document.addEventListener('keyup', e => { if (game && game.keyup) game.keyup(e); });
  window.addEventListener('resize', fitCanvas);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCanvas);   // スマホのアドレスバーの出入り
  ui.menu.addEventListener('click', e => { if (e.target === ui.menu && !pickerOpen) closeMenu(); });

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
  ui['btn-font'].onclick = cycleFont;
  ui['btn-credits'].onclick = showCredits;
  ui['btn-memories'].onclick = () => { showMemories(); ui.menu.classList.remove('hidden'); };   // タイトルからも おもいで を見られる（終章のまとめの案内先）
  ui['btn-costume'].onclick = cycleCostume;
  ui['btn-menu'].onclick = openMenu;   // メニューは常に出しておく
  ui['btn-found'].onclick = () => { showFound(); ui.menu.classList.remove('hidden'); };

  // ---------- 起動 ----------
  loadSettings();
  applySize();
  if (params.get('debug') === '1') {     // 確認用: 画面の大きさを表示
    document.querySelector('.note').textContent = `画面 ${window.innerWidth}×${window.innerHeight} / 倍率 ${window.devicePixelRatio}`;
  }
  (params.get('tags') || '').split(',').filter(Boolean).forEach(tag => {
    DATA.chapters.forEach((ch, ci) => ch.blocks.forEach(b => b.discoveries.forEach(d => { if ((d.tags || []).includes(tag)) E.runFound[`c${ci + 1}.${d.id}`] = d.name; })));
  });
  { const boot = loadProgress(); if (boot) { E.found = Object.assign({}, boot.found || {}); E.special = Object.assign({}, boot.special || {}); } }   // はっけんのコレクションは周回をまたいで残す（再読み込み後の「はじめから」や ?start= でも。周回の記録は つづきから のときだけ戻す）
  (params.get('found') || '').split(',').filter(Boolean).forEach(k => { E.found[k] = 'debug'; E.runFound[k] = 'debug'; });   // 確認用: ?found=c1.だっこ で前の章のはっけんを持って始める（だっこの区間など）
  // 確認用: ?special=4 で とくべつ4つ、?tags=くいしんぼ,ねぼすけ でその性格の反応を全部見つけたことにする（周回の記録に入れる）
  if (params.get('special') === '4') for (let i = 0; i < 4; i++) E.runSpecial['debug.' + i] = 'x';
  const startAt = params.get('start');   // 確認用: ?start=0 で1章から直接
  fitCanvas();   // タイトルの倍率（--sm）も最初に決める
  if (startAt !== null && DATA.chapters[Number(startAt)]) startChapter(Number(startAt));
  else initTitle();
  if (params.get('gallery') === 'walk') {   // 確認用: 3章の物と誘惑を道に並べて見る（&seg=1|2|3、&zoom=1 で 3 倍の一覧）
    if (startAt === null) startChapter(2);
    startMinigame({ name: 'よみちさんぽ', params: { 区間: params.get('seg') || '1', gallery: params.get('zoom') === '1' ? 'zoom' : 'road' } });
  }
})();
