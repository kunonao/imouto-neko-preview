// 妹はネコ 攻略ページ。はっけんの一覧と性格の数は、ゲームの data.js から作る（台本を直しても表がずれない）
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  // ---------- 反転（タップでも開く） ----------
  document.querySelectorAll('.hanten').forEach(h => {
    const open = () => h.classList.add('open');
    h.addEventListener('click', open);
    h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });

  // ---------- カレンダー（記事の日付 2027年3月21日） ----------
  {
    const cal = $('#cal'), Y = 2027, M = 2, TODAY = 21;
    cal.appendChild(el('caption', null, `${Y}年${M + 1}月`));
    const head = el('tr');
    ['日', '月', '火', '水', '木', '金', '土'].forEach((d, i) => head.appendChild(el('th', i === 0 ? 'sun' : i === 6 ? 'sat' : '', d)));
    cal.appendChild(head);
    const first = new Date(Y, M, 1).getDay(), days = new Date(Y, M + 1, 0).getDate();
    let tr = el('tr');
    for (let i = 0; i < first; i++) tr.appendChild(el('td'));
    for (let d = 1; d <= days; d++) {
      const w = (first + d - 1) % 7;
      tr.appendChild(el('td', [w === 0 ? 'sun' : w === 6 ? 'sat' : '', d === TODAY ? 'today' : ''].join(' ').trim(), String(d)));
      if (w === 6) { cal.appendChild(tr); tr = el('tr'); }
    }
    if (tr.children.length) cal.appendChild(tr);
  }

  // ---------- 拍手（この端末の中だけ。どこにも送らない） ----------
  {
    const MSG = ['拍手ありがとう！', 'うれしいわ〜(*´ω｀*)', '葵にも伝えとくな！', 'まだ押してくれるん？', 'ほんまおおきに！'];
    let n = 0;
    try { n = Number(localStorage.getItem('imouto-neko-guide-clap')) || 0; } catch (e) { /* 保存できなくても動く */ }
    $('#clap').addEventListener('click', () => {
      n++;
      try { localStorage.setItem('imouto-neko-guide-clap', String(n)); } catch (e) { /* 同上 */ }
      $('#clap-msg').textContent = MSG[(n - 1) % MSG.length];
    });
  }

  // ---------- ゲームのデータから表を作る ----------
  const DATA = window.GAME_DATA;
  if (!DATA) {
    document.querySelectorAll('.loading').forEach(p => { p.textContent = 'ゲームのデータを読めへんかった……。ゲームと同じ場所に置いて開いてな'; });
    return;
  }
  const chapters = DATA.chapters.slice(0, 4);   // 終章にははっけんがない
  const TAGS = ['くいしんぼ', 'あまえんぼ', 'いたずら', 'ねぼすけ', 'おしゃべり', 'かんさつ'];
  const ED = { くいしんぼ: '妹はくいしんぼネコ', あまえんぼ: '妹はあまえんぼネコ', いたずら: '妹はいたずらネコ', ねぼすけ: '妹はねぼすけネコ', おしゃべり: '妹はおしゃべりネコ', かんさつ: '妹はみつめるネコ' };

  // 章ごとに、id の重複を除いた はっけん（最初に書かれた場所の条件を使う）
  const perChapter = chapters.map(ch => {
    const seen = new Set(), list = [];
    ch.blocks.forEach(b => b.discoveries.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); list.push({ d, b }); } }));
    return list;
  });

  // 全部の数と性格ごとの数
  const totals = {};
  let all = 0;
  perChapter.forEach(list => list.forEach(({ d }) => { if (!d.special) all++; (d.tags || []).forEach(t => { totals[t] = (totals[t] || 0) + 1; }); }));
  document.querySelectorAll('[data-count="all"]').forEach(s => { s.textContent = String(all); });

  {
    const table = $('#need-table');
    table.querySelector('.loading').parentNode.remove();
    TAGS.forEach(t => {
      const total = totals[t] || 0, need = Math.max(3, Math.ceil(total * 0.4 - 1e-9));
      const tr = el('tr');
      tr.appendChild(el('td', null, ED[t]));
      const td = el('td'); td.appendChild(el('span', 'tag ' + t, t)); tr.appendChild(td);
      tr.appendChild(el('td', null, `${total}個`));
      tr.appendChild(el('td', null, `${need}個〜`));
      table.appendChild(tr);
    });
  }

  // 条件を、遊ぶ人の言葉に（分からない条件は出さない）
  const COND = {
    '葵:ゆか': '床で', '葵:つくえ': '机の上で', '葵:ソファ': 'ソファの上で', '葵:テーブル': 'テーブルの上で', '葵:ベンチ': 'ベンチの上で', '葵:いす': '葵の席（スツール）で', '葵:となり': 'お姉ちゃんの隣で',
    '茜:つくえ': 'お姉ちゃんが作業中', '茜:ソファ': 'お姉ちゃんが休憩中',
    '場所:いえのまえ': '家の前で', '場所:こうえん': '公園で', '場所:しょうてんがい': '商店街で', '場所:かわら': '川原で',
    'みた姉:0': '1回目', 'みた写真:0': '1回目', 'みたマグ:0': '1回目', '原稿:みてない': '1回目', 'ねころび:0': '1回目', 'マグ:みてない': '1回目', 'スマホ:ある': '1回目',
    'ごはん:まだ': '1回目', 'ごはん:たべた': 'ごはんのあと', 'じゃらし:あそんだ': 'ねこじゃらしで遊んだあと', 'プリン:みた': 'ふたの名前を見たあと', 'スプーン:かえた': 'スプーンを落としたあと',
    'おとした:0': '1つ目', 'おとした:1': '2つ目', 'おとした:2': '3つ目',
    'ねるまえ:いま': '寝る前に', 'メモ:ひらき': 'メモが開いたあと', 'あいず:きいた': '合図のあと',
  };
  const condText = b => [...new Set((b.conds || []).map(c => COND[c[0] + ':' + c[1]]).filter(Boolean))].join('・');

  const box = $('#disc-list');
  box.textContent = '';
  perChapter.forEach((list, ci) => {
    const det = el('details', 'disc-ch');
    const normal = list.filter(x => !x.d.special).length;
    det.appendChild(el('summary', null, `${chapters[ci].title}（${normal}個 ＋ ★${list.length - normal}）`));
    const table = el('table', 'disc-table');
    const head = el('tr');
    ['はっけん', '見つけかた', '性格'].forEach(h => head.appendChild(el('th', null, h)));
    table.appendChild(head);
    list.forEach(({ d, b }) => {
      const tr = el('tr', d.special ? 'sp' : '');
      tr.appendChild(el('td', null, (d.special ? '★ ' : '') + d.name));
      const td = el('td');
      const how = d.special ? el('span', 'hanten') : td;   // ★の場所は反転で隠す
      const where = d.where || b.key || '';
      const cond = condText(b);
      if (where && where !== 'ついていく') how.appendChild(document.createTextNode(where + (cond ? `（${cond}）` : '')));
      if (d.hint) how.appendChild(el('span', 'hint', d.hint));
      else if (!where || where === 'ついていく') how.appendChild(el('span', 'hint', 'よみちさんぽで'));
      if (d.special) { how.tabIndex = 0; how.addEventListener('click', () => how.classList.add('open')); td.appendChild(how); }
      tr.appendChild(td);
      const tagTd = el('td');
      (d.special ? ['とくべつ'] : (d.tags || [])).forEach(t => tagTd.appendChild(el('span', 'tag ' + t, t)));
      tr.appendChild(tagTd);
      table.appendChild(tr);
    });
    det.appendChild(table);
    box.appendChild(det);
  });
})();
