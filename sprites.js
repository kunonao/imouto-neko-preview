// 素材一覧ページ（確認用）。data.js の art を拡大して並べる
(function () {
  'use strict';
  const art = window.GAME_DATA.art;
  const list = document.getElementById('list');
  let zoom = 8, bg = '#8c8c8c';
  function draw() {
    list.replaceChildren();
    for (const sp of Object.values(art.sprites)) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const c = document.createElement('canvas');
      c.width = sp.w; c.height = sp.h;
      c.style.width = sp.w * zoom + 'px';
      c.style.height = sp.h * zoom + 'px';
      c.style.background = bg;
      const g = c.getContext('2d');
      sp.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = art.palette[row[x]];
          if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
        }
      });
      cell.appendChild(c);
      cell.appendChild(document.createTextNode(`${sp.id} ${sp.w}x${sp.h}`));
      list.appendChild(cell);
    }
  }
  document.querySelectorAll('button[data-z]').forEach(b => { b.onclick = () => { zoom = Number(b.dataset.z); draw(); }; });
  document.querySelectorAll('button[data-bg]').forEach(b => { b.onclick = () => { bg = b.dataset.bg; draw(); }; });
  draw();
})();
