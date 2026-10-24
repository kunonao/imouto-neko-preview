// 妹はネコ ゲームの中身（状態・台本の実行）。画面の都合を持ち込まない。
// ブラウザでは window.Engine、Node では require で使う（tools/playtest.js）。
(function (root) {
  'use strict';

  const PREF = ['なく', 'すりすり', 'みる', 'のる', 'おりる', 'おとす', 'ふむ', 'ねころぶ', 'あそぶ', 'たべる', 'ついていく', 'つめ'];
  // エンディング判定用の状態（tools/build.js の TAGS と同じタグ。Codex と相談して決めた値）
  //   ネコ        = その周回で見つけた割合がいちばん高い性格（割合 40% 以上、3個以上）。同率は先のタグ。なければ ふつう
  //   トップ.◯◯  = その性格が同率1位のとき あり（終章の候補に使う）
  //   すなお      = あまえんぼ を 8 個以上（終章の台本では、さらに 4章で頭を預けたこと c4.あずけた を条件にする）
  //   かしこい    = お姉ちゃんに迷惑をかけず（いたずら 0 個）、寄り道少なく（手数 26 以下）、1〜4章を完走（2026-10-24 ユーザー決定。Codex 第42回）
  //                 内部では 1章の冷めたお茶（c1.おちゃ）も見る（いたずら 0 なら必ず満たす。説明は「いたずらなし」のまま）
  //                 手数 = その周回で実行したコマンドの数（ヒントは数えない）＋ よみちさんぽで寄り道した回数。台詞送り・メニュー・ミニゲームの中の操作は数えない
  //                 手数を持たない古い保存の周回は判定しない（null。0 扱いにすると誤って届くため）
  //   とくべつ    = その周回で見つけた とくべつなはっけん の数（4 で 姉もネコ）
  //   完走        = 1〜4章をこの周回でクリアしたら 完走、でなければ 途中
  //   ヒント      = ヒントコマンドを見た回数（会話の中の誘導は数えない）
  const TAGS = ['くいしんぼ', 'あまえんぼ', 'いたずら', 'ねぼすけ', 'おしゃべり', 'かんさつ'];
  const RULE = { 割合: 0.4, 最低: 3, すなお: 8, 手数: 26 };
  const matches = (conds, state) => conds.every(([k, v, neg]) => neg ? String(state[k]) !== v : String(state[k]) === v);
  const parseCond = t => { const m = t.match(/^([^:!]+)(!?):(.+)$/); return m ? (m[2] ? [m[1], m[3], '!'] : [m[1], m[3]]) : [t, '']; };
  const copyRun = r => JSON.parse(JSON.stringify(r));
  // spot = 状態を変えない見た目だけの位置（!いち 葵 つくえあしもと）。!茜 / !葵 / !場面 で消える
  // hidden = !かたづけ で消した小物（場面の初期小物も消せる）。!小物 で戻る
  const freshVisual = () => ({ scene: '', props: {}, fallen: {}, hidden: {}, pc: '', pose: { 茜: 'ふつう', 葵: 'すわり' }, spot: {}, objective: '', pudding: 180 });

  class Engine {
    constructor(data) {
      this.data = data;
      this.found = {};    // 章をまたいで残る: id -> 表示名（コレクション）
      this.special = {};
      this.runFound = {}; // この周回で見つけたもの（エンディングの判定に使う。1章を始めると空になる）
      this.runSpecial = {};
      this.runCleared = {}; // この周回でクリアした章
      this.runRoutes = {};  // この周回の章ごとのルート（章番号 -> ルート名。おもいで で「今回」と「前の周回」を分ける）
      this.hints = 0;     // この周回でヒントを見た回数
      this.actions = 0;   // この周回の手数（かしこいネコの判定。null = 古い保存で不明）
      this.ending = '';   // 到達したエンディング名（!エンド）
      this.runAt = {};    // 章を始めた時点の周回の記録（章をえらび直したとき、そこへ巻き戻す）
      this.chapterIndex = -1;
      this.chapter = null;
      this.state = {};
      this.visual = null;
      this.queue = [];
      this.pending = [];
      this.waitingGame = null;
      this.cleared = false;
    }

    get chapters() { return this.data.chapters; }

    // 章を始める。プロローグ → はじまり の順に実行待ちに積む
    startChapter(i, restart) {   // restart = 途中の章から新しい周回として始める（時間をえらぶ）
      const ch = this.chapters[i];
      if (!ch) throw new Error('章がない: ' + i);
      if (i === 0 || restart) { this.runFound = {}; this.runSpecial = {}; this.runCleared = {}; this.runRoutes = {}; this.hints = 0; this.actions = 0; this.ending = ''; this.runAt = {}; }   // 新しい周回（あさ から、または 時間をえらぶ で途中から。前の章は通っていない扱い）
      else if (this.runAt[i]) { this.setRun(copyRun(this.runAt[i])); for (const k of Object.keys(this.runAt)) if (Number(k) > i) delete this.runAt[k]; }   // 章をえらび直した: その章を始めた時点へ巻き戻し、それより後の章の記録は捨てる（やり直しの成果を次章で上書きしない）
      this.runAt[i] = copyRun(this.getRun());
      this.chapterIndex = i;
      this.chapter = ch;
      this.hintMode = false;   // ヒントの表示状態は章をまたがない
      this.state = Object.assign({}, ch.initial);
      // この周回のはっけんを状態として見せる（c1.げんこうほうかい:すみ など）
      for (const k of Object.keys(this.runFound)) this.state[k] = 'すみ';
      for (const k of Object.keys(this.runSpecial)) this.state[k] = 'すみ';
      Object.assign(this.state, this.endingState());
      if (ch.candidates && ch.candidates.length) { const c = this.candidates(); this.state.えらんだ = c[0] || 'なし'; }
      this.visual = freshVisual();
      this.cleared = false;
      this.waitingGame = null;
      this.queue = [];
      this.pending = [];
      for (const n of ['プロローグ', 'はじまり']) if (ch.named[n] !== undefined) this.queue.push(...this.enter(ch.blocks[ch.named[n]]));
    }

    // ミニゲームの分岐の中で宣言されたはっけんは、その結果が出たときに付ける
    enter(block) { this.pending.push(...block.discoveries.filter(d => !d.branch && !d.inline)); return block.items.slice(); }

    getRun() { return { runFound: this.runFound, runSpecial: this.runSpecial, runCleared: this.runCleared, runRoutes: this.runRoutes, hints: this.hints, actions: this.actions, ending: this.ending }; }
    setRun(r) { this.runFound = r.runFound || {}; this.runSpecial = r.runSpecial || {}; this.runCleared = r.runCleared || {}; this.runRoutes = r.runRoutes || {}; this.hints = Number(r.hints) || 0; this.actions = Number.isFinite(r.actions) ? r.actions : null; this.ending = r.ending || ''; }
    addActions(n) { if (this.actions !== null) this.actions += n; }

    // エンディング判定用の状態（とくべつ / ネコ / トップ.◯◯ / かず.◯◯ / ヒント / すなお / かしこい / 完走 / ふつう）
    endingState() {
      const totals = {}, counts = {}, seen = new Set();
      this.chapters.forEach((ch, ci) => ch.blocks.forEach(b => b.discoveries.forEach(d => {
        const key = `c${ci + 1}.${d.id}`;
        if (seen.has(key)) return;   // 同じ id が複数の場所に書かれていても1つ
        seen.add(key);
        const hit = !!this.runFound[key];
        (d.tags || []).forEach(t => { totals[t] = (totals[t] || 0) + 1; if (hit) counts[t] = (counts[t] || 0) + 1; });
      })));
      const s = { とくべつ: String(Object.keys(this.runSpecial).length), ヒント: String(this.hints), ふつう: 'あり' };
      const ranked = TAGS.map(t => ({ t, n: counts[t] || 0, r: totals[t] ? (counts[t] || 0) / totals[t] : 0 }));
      TAGS.forEach(t => { s['かず.' + t] = String(counts[t] || 0); s['トップ.' + t] = 'なし'; });
      const ok = ranked.filter(x => x.r >= RULE.割合 && x.n >= RULE.最低);
      const best = ok.length ? Math.max(...ok.map(x => x.r)) : 0;
      const tops = ok.filter(x => x.r === best);
      tops.forEach(x => { s['トップ.' + x.t] = 'あり'; });
      s.ネコ = tops.length ? tops[0].t : 'ふつう';
      s.すなお = (counts.あまえんぼ || 0) >= RULE.すなお ? 'あり' : 'なし';
      const done = this.chapters.slice(0, -1).every((_, i) => this.runCleared[i]);
      s.完走 = done ? '完走' : '途中';
      s.手数 = this.actions === null ? '不明' : String(this.actions);
      // c1.おちゃ は いたずら 0 なら必ず満たす（1章の残り 2 つの解き方は いたずら）が、「冷めたお茶が肝」という意図を明示しておく（Codex 第43回）
      s.かしこい = done && !(counts.いたずら) && !!this.runFound['c1.おちゃ'] && this.actions !== null && this.actions <= RULE.手数 ? 'あり' : 'なし';
      return s;
    }

    // 終章の候補（!候補）のうち、今の状態で条件を満たすもの。優先順。「ふつう」は他に候補がないときだけ
    candidates() {
      const list = (this.chapter.candidates || []).filter(c => matches(c.conds, this.state));
      const real = list.filter(c => !c.conds.every(([k]) => k === 'ふつう'));
      return (real.length ? real : list).map(c => c.name);
    }
    blocksFor(key) { return this.chapter.blocks.filter(b => b.key === key); }

    isVisible(key) {
      const rules = this.chapter.show.filter(r => r.keys.includes(key));
      if (rules.length && !rules.some(r => matches(r.conds, this.state))) return false;
      return this.blocksFor(key).some(b => matches(b.conds, this.state));
    }

    // 今選べるコマンド。[{base, targets:[...]}] の形
    commands() {
      if (!this.chapter) return [];
      const keys = [...new Set(this.chapter.blocks.filter(b => b.key && b.key !== 'ヒント').map(b => b.key))];
      const groups = new Map();
      for (const k of keys) {
        if (!this.isVisible(k)) continue;
        const [base, tgt] = k.split('→');
        if (!groups.has(base)) groups.set(base, []);
        if (tgt) groups.get(base).push(tgt);
      }
      const order = b => { const i = PREF.indexOf(b); return i < 0 ? 99 : i; };
      return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([base, targets]) => ({ base, targets }));
    }

    hasHint() { return !!this.chapter && this.blocksFor('ヒント').length > 0; }
    busy() { return this.queue.length > 0 || !!this.waitingGame; }

    // コマンドを実行し始める。合うブロックが無ければ false
    begin(key) {
      if (this.busy()) throw new Error('行動の途中');
      const b = this.blocksFor(key).find(x => matches(x.conds, this.state));
      if (!b) return false;
      if (key === 'ヒント') this.hints++; else this.addActions(1);
      this.hintMode = key === 'ヒント';   // ヒントの行は葵の心の声ではない（話者名を出さない・音声も作らない）
      this.pending = [];
      this.queue = this.enter(b);
      return true;
    }

    // 次の出来事を返す。say / minigame / scene / objective / fade / end
    next(input) {
      if (this.waitingGame) {
        const r = input && input.result;
        if (!r) return { type: 'minigame', name: this.waitingGame.name, params: this.waitingGame.params };
        if (input.set) Object.assign(this.state, input.set);   // ミニゲームの成績など（例: さんぽ=ぴったり）
        if (input.set && Number(input.set.寄り道回数) > 0) this.addActions(Number(input.set.寄り道回数));   // よみちさんぽの寄り道も手数
        const g = this.waitingGame;
        this.pending.push(...((g.branchDisc && g.branchDisc[r]) || []));
        this.queue.unshift(...(g.branches[r] || []));
        this.waitingGame = null;
      }
      while (this.queue.length) {
        const it = this.queue.shift();
        if (it.cond && !matches(it.cond, this.state)) continue;   // ?条件 の行。合わなければ飛ばす
        if (it.type === 'disc') { this.pending.push(it); continue; }   // 条件付きのはっけん
        if (it.type === 'say') {   // hint = ヒントの行（話者名なし）。special = とくべつ のはっけんがある行動の中の行（枠と話者名を金色に。Codex 第31回で合意）
          const special = this.pending.some(d => d.special);
          return this.hintMode || special ? Object.assign({}, it, this.hintMode ? { hint: true } : {}, special ? { special: true } : {}) : it;
        }
        if (it.type === 'minigame') { this.waitingGame = it; return { type: 'minigame', name: it.name, params: it.params }; }
        const ev = this.apply(it);
        if (ev) return ev;
      }
      const fresh = [];
      for (const d of this.pending) {
        const id = `c${this.chapterIndex + 1}.${d.id}`;
        const store = d.special ? this.special : this.found;
        const run = d.special ? this.runSpecial : this.runFound;
        const again = !!store[id];   // コレクションには前の周回からある
        if (!store[id]) store[id] = d.name;
        if (!run[id]) { run[id] = d.name; this.state[id] = 'すみ'; fresh.push(Object.assign({}, d, { again })); }   // この周回で初めて → 札を出す（帯も今回の数）
      }
      this.pending = [];
      return { type: 'end', cleared: this.cleared, fresh };
    }

    apply(it) {
      const a = it.args, v = this.visual, s = this.state;
      switch (it.name) {
        case 'set': { const m = a.match(/^([^=]+)=(.*)$/); if (m) s[m[1].trim()] = m[2].trim(); return null; }
        case 'add': { const m = a.match(/^(.+?)([+-]\d+)$/); if (m) { const k = m[1].trim(); s[k] = String((Number(s[k]) || 0) + Number(m[2])); } return null; }
        case 'へ': {
          const idx = this.chapter.named[a];
          if (idx === undefined) throw new Error('移動先がない: ' + a);
          this.queue = this.enter(this.chapter.blocks[idx]);
          return null;
        }
        case '茜': case '葵': s[it.name] = a; delete v.spot[it.name]; return null;   // 状態の位置へ。見た目だけの位置は消える
        case 'すがた': case '茜すがた': s[it.name] = a; return null;
        case 'いち': {   // !いち 葵 つくえあしもと: 反応の中で寄った先。次に !葵 で動くまでそこに留まる（状態は変えない）
          const m = a.match(/^(茜|葵)\s+(\S+)$/);
          if (m) v.spot[m[1]] = m[2];
          return null;
        }
        case 'かたづけ': delete v.props[a]; delete v.fallen[a]; v.hidden[a] = true; return null;   // 小物を場面から消す（冷蔵庫へしまう など）
        case 'もし': {   // !もし 条件 条件 へ 名前
          const m = a.match(/^(.*?)\s*へ\s+(\S+)$/);
          if (!m) return null;
          const conds = m[1].trim().split(/\s+/).filter(Boolean).map(parseCond);
          if (matches(conds, s)) {
            const idx = this.chapter.named[m[2]];
            if (idx === undefined) throw new Error('移動先がない: ' + m[2]);
            this.queue = this.enter(this.chapter.blocks[idx]);
          }
          return null;
        }
        case '茜ポーズ': v.pose.茜 = a; return null;
        case '葵ポーズ': v.pose.葵 = a; return null;
        case '小物': v.props[a] = true; delete v.fallen[a]; delete v.hidden[a]; return null;
        case 'おとす': v.fallen[a] = true; return null;
        case 'PC': v.pc = a === 'もどす' ? '' : a; return null;
        case '衣装': v.costume = (a === 'なし' || a === '設定') ? '' : a; return null;   // 場面ごとの着替え。空なら設定の衣装
        case 'エンド': this.ending = a; return null;   // 到達したエンディングの名前
        case '場面': v.scene = a; v.props = {}; v.fallen = {}; v.hidden = {}; v.spot = {}; v.pc = ''; return { type: 'scene', scene: a };
        case '暗転': return { type: 'fade' };
        case 'もくひょう': {   // 章の最初だけ全画面のカード。途中で目標が変わるときは帯と札の更新だけ（カットインを二度出さない）
          const first = !v.objectiveShown;
          v.objective = a; v.objectiveShown = true;
          return { type: 'objective', text: a, first };
        }
        case 'クリア': this.cleared = true; this.runCleared[this.chapterIndex] = true; this.queue = []; return null;
        default: return null; // 未知の演出命令は無視（表示側で必要なら足す）
      }
    }

    // この章のはっけん数
    counts(ci = this.chapterIndex) {
      const pre = `c${ci + 1}.`;
      const ids = new Set();
      const all = this.chapters[ci].blocks.flatMap(b => b.discoveries).filter(d => !ids.has(d.id) && ids.add(d.id));
      return {
        found: Object.keys(this.found).filter(k => k.startsWith(pre)).length,
        run: Object.keys(this.runFound).filter(k => k.startsWith(pre)).length,   // この周回で見つけた数
        runSpecial: Object.keys(this.runSpecial).filter(k => k.startsWith(pre)).length,
        total: all.filter(d => !d.special).length,
        special: Object.keys(this.special).filter(k => k.startsWith(pre)).length,
        specialTotal: all.filter(d => d.special).length,
      };
    }

    // この章の全はっけん（見つけたものだけ名前が入る）
    discoveryList(ci = this.chapterIndex) {   // ci: 見たい章（おもいで で他の章も見る。進行は変えない）
      const pre = `c${ci + 1}.`;
      const seen = new Set();
      const list = [];
      for (const d of this.chapters[ci].blocks.flatMap(b => b.discoveries)) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        const got = (d.special ? this.special : this.found)[pre + d.id];
        list.push({ id: d.id, name: got ? d.name : null, special: d.special, run: !!(d.special ? this.runSpecial : this.runFound)[pre + d.id], where: d.where, auto: d.auto, hint: d.hint });   // run = この周回で見つけた。where/hint = 思い出すヒント
      }
      return list;
    }

    snapshot() {
      return { v: 1, chapterIndex: this.chapterIndex, state: this.state, visual: this.visual, found: this.found, special: this.special,
        runFound: this.runFound, runSpecial: this.runSpecial, runCleared: this.runCleared, runRoutes: this.runRoutes, hints: this.hints, actions: this.actions, ending: this.ending, runAt: this.runAt };
    }

    // コレクションと周回の記録を戻す（章の頭から始めるとき用）
    restoreRun(snap) {
      this.found = Object.assign({}, snap.found || {});
      this.special = Object.assign({}, snap.special || {});
      this.setRun(copyRun({ runFound: snap.runFound, runSpecial: snap.runSpecial, runCleared: snap.runCleared, runRoutes: snap.runRoutes, hints: snap.hints, actions: snap.actions, ending: snap.ending }));
      this.runAt = copyRun(snap.runAt || {});
    }

    restore(snap) {
      const i = snap.chapterIndex;
      if (!this.chapters[i] || typeof snap.state !== 'object' || !snap.state) return false;
      this.chapterIndex = i;
      this.chapter = this.chapters[i];
      this.state = Object.assign({}, this.chapter.initial, snap.state);
      this.visual = Object.assign(freshVisual(), snap.visual && typeof snap.visual === 'object' ? snap.visual : {});
      { const fv = freshVisual(); for (const k of ['props', 'fallen', 'hidden', 'spot', 'pose']) if (!this.visual[k] || typeof this.visual[k] !== 'object') this.visual[k] = fv[k]; }   // 壊れた保存でも描画で落ちない
      this.hintMode = false;
      this.restoreRun(snap);
      this.queue = []; this.pending = []; this.waitingGame = null; this.cleared = false;
      return true;
    }
  }

  root.Engine = Engine;
})(typeof window !== 'undefined' ? window : (typeof module !== 'undefined' ? module.exports : globalThis));
