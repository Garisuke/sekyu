(() => {
  'use strict';

  const STORAGE_KEY = 'sekyu:v1';
  const CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'];
  const ACTIVITY_DAYS = 14;

  const app = document.getElementById('app');
  const tooltip = document.getElementById('tooltip');
  const examSelect = document.getElementById('exam-select');
  const reviewBadge = document.getElementById('review-badge');

  // ---------- 保存データ ----------
  // { exam: 'sg', attempts: [{ qid, chosen, correct, at }] }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.attempts)) return parsed;
      }
    } catch (e) {
      console.warn('学習データを読み込めませんでした', e);
    }
    return { exam: Object.keys(EXAMS)[0], attempts: [] };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('学習データを保存できませんでした', e);
    }
  }

  let state = loadState();
  if (!EXAMS[state.exam]) state.exam = Object.keys(EXAMS)[0];

  // 解答中の問題セット（メモリ上のみ）
  let quiz = null;

  // ---------- 集計 ----------
  const exam = () => EXAMS[state.exam];
  const examQuestions = () => QUESTIONS.filter((q) => q.exam === state.exam);
  const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));

  function examAttempts() {
    return state.attempts.filter((a) => questionById.get(a.qid)?.exam === state.exam);
  }

  // qid ごとの { total, correct, last }
  function statsByQuestion(attempts = examAttempts()) {
    const map = new Map();
    for (const a of attempts) {
      const s = map.get(a.qid) || { total: 0, correct: 0, last: null };
      s.total++;
      if (a.correct) s.correct++;
      if (!s.last || a.at >= s.last.at) s.last = a;
      map.set(a.qid, s);
    }
    return map;
  }

  // 最後の解答が不正解だった問題 = 復習待ち
  function reviewQuestions() {
    const stats = statsByQuestion();
    return examQuestions().filter((q) => {
      const s = stats.get(q.id);
      return s && !s.last.correct;
    });
  }

  function dayKey(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function streakDays(daySet) {
    const d = new Date();
    // 今日まだ解いていなくても、昨日まで続いていれば連続とみなす
    if (!daySet.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (daySet.has(dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 「IPA 令和元年度秋期 情報セキュリティマネジメント試験 午前 問1」→「R1秋 問1」のような短い表記
  const ERA = { '令和': 'R', '平成': 'H' };
  function sourceLabel(q) {
    const m = q.source.match(/(令和|平成)(元|\d+)年度(春|秋)期.*問(\d+)/);
    if (!m) return '過去問';
    return `過去問 ${ERA[m[1]]}${m[2] === '元' ? 1 : m[2]}${m[3]} 問${m[4]}`;
  }

  // 出典ごとのグループ（オリジナル / 各回の過去問）
  function sourceGroup(q) {
    return q.source ? q.id.split('-')[1] : 'original';
  }

  // ---------- 用語集 ----------
  // 先頭の文字ごとに見出し語・別名を長い順に並べておき，文中を最長一致で走査する
  // （「公開鍵暗号方式」が「公開鍵」と重複して拾われないようにするため）
  const glossaryIndex = new Map();
  for (const entry of window.GLOSSARY || []) {
    for (const key of [entry.term, ...(entry.aliases || [])]) {
      const list = glossaryIndex.get(key[0]) || [];
      list.push({ key, entry });
      glossaryIndex.set(key[0], list);
    }
  }
  glossaryIndex.forEach((list) => list.sort((a, b) => b.key.length - a.key.length));

  const isAlnum = (c) => !!c && /[A-Za-z0-9]/.test(c);

  // 文章に出てくる用語を，出現順に重複なく返す
  function findTerms(texts) {
    const found = [];
    for (const text of texts) {
      let i = 0;
      while (i < text.length) {
        const hit = (glossaryIndex.get(text[i]) || []).find(({ key }) =>
          text.startsWith(key, i) &&
          // 英字の略語は単語の途中で一致させない（例：「CA」を「CAPTCHA」の中で拾わない）
          !(isAlnum(key[0]) && isAlnum(text[i - 1])) &&
          !(isAlnum(key[key.length - 1]) && isAlnum(text[i + key.length])));
        if (hit) {
          if (!found.includes(hit.entry)) found.push(hit.entry);
          i += hit.key.length;
        } else {
          i++;
        }
      }
    }
    return found;
  }

  const GLOSSARY_OPEN_KEY = 'sekyu:glossaryOpen';
  function glossaryOpen() {
    try { return localStorage.getItem(GLOSSARY_OPEN_KEY) !== '0'; } catch (e) { return true; }
  }

  function renderGlossary(q) {
    const terms = findTerms([q.question, ...q.choices, q.explanation]);
    if (terms.length === 0) return '';
    return `
      <details class="glossary"${glossaryOpen() ? ' open' : ''}>
        <summary>用語メモ <small>${terms.length}語</small></summary>
        <dl>
          ${terms.map((t) => `<div><dt>${escapeHtml(t.term)}</dt><dd>${escapeHtml(t.desc)}</dd></div>`).join('')}
        </dl>
      </details>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ---------- ヘッダー ----------
  function renderHeader(route) {
    const ids = Object.keys(EXAMS);
    examSelect.hidden = ids.length < 2;
    examSelect.innerHTML = ids
      .map((id) => `<option value="${id}"${id === state.exam ? ' selected' : ''}>${escapeHtml(EXAMS[id].name)}</option>`)
      .join('');

    document.querySelectorAll('.nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === route || (route === 'quiz' && a.dataset.route === 'practice'));
    });

    const n = reviewQuestions().length;
    reviewBadge.hidden = n === 0;
    reviewBadge.textContent = n;
  }

  examSelect.addEventListener('change', () => {
    state.exam = examSelect.value;
    saveState();
    quiz = null;
    render();
  });

  // ---------- ダッシュボード ----------
  function renderDashboard() {
    const questions = examQuestions();
    const attempts = examAttempts();
    const stats = statsByQuestion(attempts);
    const correct = attempts.filter((a) => a.correct).length;
    const days = new Set(attempts.map((a) => dayKey(a.at)));
    const reviewCount = reviewQuestions().length;

    if (attempts.length === 0) {
      app.innerHTML = `
        <section class="hero card">
          <h1>${escapeHtml(exam().name)}</h1>
          <p>まずは問題を解いてみましょう。解いた結果がここに記録され、分野ごとの正答率や学習日数を確認できます。</p>
          <p class="muted">収録問題数: ${questions.length}問</p>
          <a class="btn primary" href="#/practice">問題演習を始める</a>
        </section>`;
      return;
    }

    const tiles = [
      { label: '総合正答率', value: `${pct(correct, attempts.length)}<small>%</small>`, sub: `${correct} / ${attempts.length} 回正解` },
      { label: '学習した問題', value: `${stats.size}<small> / ${questions.length}</small>`, sub: `カバー率 ${pct(stats.size, questions.length)}%` },
      { label: '連続学習', value: `${streakDays(days)}<small>日</small>`, sub: `合計 ${days.size}日 学習` },
      { label: '復習待ち', value: `${reviewCount}<small>問</small>`, sub: reviewCount ? '<a href="#/review">復習する →</a>' : 'すべて解決済み' },
    ];

    app.innerHTML = `
      <h1 class="page-title">ダッシュボード</h1>
      <section class="tiles">
        ${tiles.map((t) => `
          <div class="tile card">
            <div class="tile-label">${t.label}</div>
            <div class="tile-value">${t.value}</div>
            <div class="tile-sub">${t.sub}</div>
          </div>`).join('')}
      </section>

      <section class="card">
        <h2>分野別の正答率</h2>
        ${renderCategoryTable(questions, stats)}
      </section>

      <section class="card">
        <h2>直近${ACTIVITY_DAYS}日間の回答数</h2>
        ${renderActivity(attempts)}
      </section>

      <div class="actions">
        <a class="btn primary" href="#/practice">問題演習を続ける</a>
        ${reviewCount ? '<a class="btn" href="#/review">間違えた問題を復習</a>' : ''}
      </div>`;
  }

  function renderCategoryTable(questions, stats) {
    const rows = Object.entries(exam().categories).map(([key, name]) => {
      const qs = questions.filter((q) => q.category === key);
      let total = 0, correct = 0, covered = 0;
      for (const q of qs) {
        const s = stats.get(q.id);
        if (!s) continue;
        covered++;
        total += s.total;
        correct += s.correct;
      }
      const p = pct(correct, total);
      const tip = total ? `${name}：${correct} / ${total} 回正解（${p}%）` : `${name}：まだ解いていません`;
      return `
        <tr>
          <th scope="row">
            <a href="#/practice?category=${key}">${escapeHtml(name)}</a>
          </th>
          <td class="bar-cell">
            <div class="hbar" data-tip="${escapeHtml(tip)}" tabindex="0" aria-label="${escapeHtml(tip)}">
              <div class="hbar-fill" style="width:${total ? Math.max(p, 1) : 0}%"></div>
            </div>
          </td>
          <td class="num">${total ? `${p}%` : '—'}</td>
          <td class="num muted">${covered} / ${qs.length}問</td>
        </tr>`;
    });
    return `
      <table class="cat-table">
        <thead><tr><th>分野</th><th>正答率</th><th class="num"></th><th class="num">学習済み</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>`;
  }

  function renderActivity(attempts) {
    const byDay = new Map();
    for (const a of attempts) {
      const k = dayKey(a.at);
      const d = byDay.get(k) || { total: 0, correct: 0 };
      d.total++;
      if (a.correct) d.correct++;
      byDay.set(k, d);
    }

    const days = [];
    const d = new Date();
    d.setDate(d.getDate() - (ACTIVITY_DAYS - 1));
    for (let i = 0; i < ACTIVITY_DAYS; i++) {
      const k = dayKey(d);
      days.push({ key: k, label: `${d.getMonth() + 1}/${d.getDate()}`, weekday: '日月火水木金土'[d.getDay()], ...(byDay.get(k) || { total: 0, correct: 0 }) });
      d.setDate(d.getDate() + 1);
    }
    const max = Math.max(...days.map((x) => x.total), 1);

    const bars = days.map((x, i) => {
      const tip = x.total
        ? `${x.label}（${x.weekday}）：${x.total}問回答、${x.correct}問正解`
        : `${x.label}（${x.weekday}）：学習なし`;
      const showLabel = i === 0 || i === days.length - 1 || i % 7 === 0;
      return `
        <div class="col" data-tip="${escapeHtml(tip)}" tabindex="0" aria-label="${escapeHtml(tip)}">
          <div class="col-plot">
            ${x.total ? `<div class="col-bar" style="height:${(x.total / max) * 100}%"></div>` : '<div class="col-empty"></div>'}
          </div>
          <div class="col-label">${showLabel ? x.label : ''}</div>
        </div>`;
    }).join('');

    return `
      <div class="activity">
        <div class="activity-axis"><span>${max}</span><span>0</span></div>
        <div class="activity-cols">${bars}</div>
      </div>`;
  }

  // ---------- 問題演習: 設定画面 ----------
  function renderPractice(params) {
    const questions = examQuestions();
    const stats = statsByQuestion();
    const cats = exam().categories;
    const selected = params.get('category') && cats[params.get('category')] ? params.get('category') : 'all';
    const unanswered = questions.filter((q) => !stats.has(q.id)).length;

    const catOptions = [['all', 'すべての分野', questions.length]]
      .concat(Object.entries(cats).map(([k, name]) => [k, name, questions.filter((q) => q.category === k).length]));

    const groups = new Map();
    for (const q of questions) {
      const g = sourceGroup(q);
      if (!groups.has(g)) groups.set(g, { label: g === 'original' ? 'オリジナル' : sourceLabel(q).replace(/^過去問 | 問\d+$/g, ''), n: 0 });
      groups.get(g).n++;
    }
    const srcOptions = [['all', 'すべて', questions.length]]
      .concat([...groups].map(([k, { label, n }]) => [k, label, n]));

    app.innerHTML = `
      <h1 class="page-title">問題演習</h1>
      <form id="practice-form" class="card form">
        <fieldset>
          <legend>分野</legend>
          <div class="chips">
            ${catOptions.map(([k, name, n]) => `
              <label class="chip">
                <input type="radio" name="category" value="${k}"${k === selected ? ' checked' : ''}>
                <span>${escapeHtml(name)} <small>${n}</small></span>
              </label>`).join('')}
          </div>
        </fieldset>

        ${srcOptions.length > 2 ? `
        <fieldset>
          <legend>出典</legend>
          <div class="chips">
            ${srcOptions.map(([k, name, n]) => `
              <label class="chip">
                <input type="radio" name="source" value="${k}"${k === 'all' ? ' checked' : ''}>
                <span>${escapeHtml(name)} <small>${n}</small></span>
              </label>`).join('')}
          </div>
          <p class="muted small">過去問は IPA 情報セキュリティマネジメント試験 午前問題（H30春〜R1秋）です。</p>
        </fieldset>` : ''}

        <fieldset>
          <legend>問題数</legend>
          <div class="chips">
            ${[5, 10, 20, 0].map((n) => `
              <label class="chip">
                <input type="radio" name="count" value="${n}"${n === 10 ? ' checked' : ''}>
                <span>${n ? `${n}問` : 'すべて'}</span>
              </label>`).join('')}
          </div>
        </fieldset>

        <fieldset>
          <legend>出題順</legend>
          <div class="chips">
            <label class="chip"><input type="radio" name="order" value="smart" checked><span>未回答・苦手を優先</span></label>
            <label class="chip"><input type="radio" name="order" value="random"><span>ランダム</span></label>
          </div>
        </fieldset>

        <p class="muted">まだ解いていない問題: ${unanswered} / ${questions.length}問</p>
        <button class="btn primary" type="submit">スタート</button>
      </form>`;

    document.getElementById('practice-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const category = fd.get('category');
      const source = fd.get('source') || 'all';
      const count = Number(fd.get('count'));
      const order = fd.get('order');

      let pool = shuffle(questions.filter((q) =>
        (category === 'all' || q.category === category) && (source === 'all' || sourceGroup(q) === source)));
      if (pool.length === 0) {
        alert('条件に合う問題がありません。分野か出典を変えてください。');
        return;
      }
      if (order === 'smart') {
        // 0: 未回答 → 1: 前回不正解 → 2: 正答率の低い順
        const rank = (q) => {
          const s = stats.get(q.id);
          if (!s) return 0;
          if (!s.last.correct) return 1;
          return 2 + s.correct / s.total;
        };
        pool.sort((a, b) => rank(a) - rank(b));
      }
      if (count) pool = pool.slice(0, count);
      startQuiz(pool, 'practice');
    });
  }

  // ---------- 問題演習: 解答画面 ----------
  function startQuiz(items, source) {
    if (items.length === 0) return;
    quiz = { items, index: 0, results: [], chosen: null, source };
    location.hash = '#/quiz';
    // 既に #/quiz の場合は hashchange が発火しない
    render();
  }

  function renderQuiz() {
    if (!quiz) {
      location.hash = '#/practice';
      return;
    }
    if (quiz.index >= quiz.items.length) {
      renderResult();
      return;
    }

    const q = quiz.items[quiz.index];
    const answered = quiz.chosen !== null;
    const isCorrect = answered && quiz.chosen === q.answer;
    const total = quiz.items.length;

    app.innerHTML = `
      <div class="quiz-top">
        <span>${quiz.source === 'review' ? '復習' : '問題演習'}　問 ${quiz.index + 1} / ${total}</span>
        <button class="link-btn" id="quit">中断する</button>
      </div>
      <div class="progress" aria-hidden="true"><div style="width:${(quiz.index / total) * 100}%"></div></div>

      <article class="card question">
        <span class="tag">${escapeHtml(exam().categories[q.category] || q.category)}</span>
        ${q.source ? `<span class="tag tag-source">${escapeHtml(sourceLabel(q))}</span>` : ''}
        <p class="q-text">${escapeHtml(q.question)}</p>
        ${q.image ? `<figure class="q-figure"><img src="${escapeHtml(q.image)}" alt="問題の図表"></figure>` : ''}
        <ol class="choices">
          ${q.choices.map((c, i) => {
            let cls = '';
            if (answered) {
              if (i === q.answer) cls = 'correct';
              else if (i === quiz.chosen) cls = 'wrong';
            }
            return `
              <li>
                <button class="choice ${cls}" data-i="${i}"${answered ? ' disabled' : ''}>
                  <span class="choice-label">${CHOICE_LABELS[i]}</span>
                  <span class="choice-text">${escapeHtml(c)}</span>
                  ${cls === 'correct' ? '<span class="mark" aria-label="正解">✓</span>' : ''}
                  ${cls === 'wrong' ? '<span class="mark" aria-label="あなたの解答">✗</span>' : ''}
                </button>
              </li>`;
          }).join('')}
        </ol>

        ${answered ? `
          <div class="feedback ${isCorrect ? 'ok' : 'ng'}" role="status">
            <strong>${isCorrect ? '✓ 正解' : `✗ 不正解　正解は「${CHOICE_LABELS[q.answer]}」`}</strong>
            <p>${escapeHtml(q.explanation)}</p>
            ${q.source ? `<p class="source">出典：${escapeHtml(q.source)}（解説は本サイト独自）</p>` : ''}
          </div>
          ${renderGlossary(q)}
          <button class="btn primary next" id="next">${quiz.index + 1 < total ? '次の問題へ' : '結果を見る'}</button>
        ` : `<p class="hint muted">キーボードの 1〜${q.choices.length} でも選べます</p>`}
      </article>`;

    app.querySelectorAll('.choice').forEach((btn) => {
      btn.addEventListener('click', () => choose(Number(btn.dataset.i)));
    });
    document.getElementById('quit').addEventListener('click', () => {
      if (quiz.results.length === 0 || confirm('演習を中断しますか？（解答済みの結果は記録されています）')) {
        quiz = null;
        location.hash = '#/';
      }
    });
    const glossary = app.querySelector('.glossary');
    if (glossary) {
      glossary.addEventListener('toggle', () => {
        try { localStorage.setItem(GLOSSARY_OPEN_KEY, glossary.open ? '1' : '0'); } catch (e) { /* 保存できなくても表示には影響しない */ }
      });
    }
    const next = document.getElementById('next');
    if (next) {
      next.addEventListener('click', nextQuestion);
      next.focus();
    }
  }

  function choose(i) {
    if (!quiz || quiz.chosen !== null) return;
    const q = quiz.items[quiz.index];
    if (i < 0 || i >= q.choices.length) return;
    quiz.chosen = i;
    const correct = i === q.answer;
    quiz.results.push({ q, chosen: i, correct });
    state.attempts.push({ qid: q.id, chosen: i, correct, at: Date.now() });
    saveState();
    render();
  }

  function nextQuestion() {
    if (!quiz || quiz.chosen === null) return;
    quiz.index++;
    quiz.chosen = null;
    render();
    window.scrollTo(0, 0);
  }

  function renderResult() {
    const { results, items } = quiz;
    const correct = results.filter((r) => r.correct).length;
    const wrong = results.filter((r) => !r.correct).map((r) => r.q);

    app.innerHTML = `
      <section class="card result">
        <h1>結果</h1>
        <div class="score">${correct}<small> / ${results.length}問正解</small></div>
        <div class="score-pct">正答率 ${pct(correct, results.length)}%</div>
        <ol class="result-list">
          ${results.map((r) => `
            <li class="${r.correct ? 'ok' : 'ng'}">
              <span class="mark">${r.correct ? '✓' : '✗'}</span>
              <span>${escapeHtml(r.q.question)}</span>
            </li>`).join('')}
        </ol>
        <div class="actions">
          ${wrong.length ? '<button class="btn primary" id="retry-wrong">間違えた問題を解き直す</button>' : ''}
          <button class="btn" id="retry-all">同じ問題をもう一度</button>
          <a class="btn" href="#/">ダッシュボードへ</a>
        </div>
      </section>`;

    document.getElementById('retry-all').addEventListener('click', () => startQuiz(shuffle(items), quiz.source));
    const rw = document.getElementById('retry-wrong');
    if (rw) rw.addEventListener('click', () => startQuiz(shuffle(wrong), 'review'));
  }

  // ---------- 復習 ----------
  function renderReview() {
    const list = reviewQuestions();
    const stats = statsByQuestion();

    if (list.length === 0) {
      app.innerHTML = `
        <h1 class="page-title">復習</h1>
        <section class="card empty">
          <p>復習待ちの問題はありません 🎉</p>
          <p class="muted">間違えた問題がここに表示されます。正解するとリストから外れます。</p>
          <a class="btn primary" href="#/practice">問題演習へ</a>
        </section>`;
      return;
    }

    app.innerHTML = `
      <h1 class="page-title">復習</h1>
      <p class="muted">前回まちがえた問題です。正解するとリストから外れます。</p>
      <div class="actions"><button class="btn primary" id="start-review">${list.length}問をまとめて復習する</button></div>
      <ul class="review-list">
        ${list.map((q) => {
          const s = stats.get(q.id);
          return `
            <li class="card">
              <span class="tag">${escapeHtml(exam().categories[q.category] || q.category)}</span>
              ${q.source ? `<span class="tag tag-source">${escapeHtml(sourceLabel(q))}</span>` : ''}
              <p class="review-q">${escapeHtml(q.question)}</p>
              <p class="muted small">間違えた回数 ${s.total - s.correct}回 ／ 最終解答 ${dayKey(s.last.at)}</p>
            </li>`;
        }).join('')}
      </ul>`;

    document.getElementById('start-review').addEventListener('click', () => startQuiz(shuffle(list), 'review'));
  }

  // ---------- 設定 ----------
  function renderSettings() {
    app.innerHTML = `
      <h1 class="page-title">設定</h1>
      <section class="card">
        <h2>学習データ</h2>
        <p class="muted">学習データはこのブラウザに保存されています（回答記録 ${state.attempts.length}件）。ブラウザのデータを消去すると記録も消えるので、ときどきバックアップしておくと安心です。</p>
        <div class="actions">
          <button class="btn" id="export">バックアップを保存</button>
          <label class="btn">バックアップから復元<input type="file" id="import" accept="application/json,.json" hidden></label>
        </div>
      </section>
      <section class="card danger-zone">
        <h2>リセット</h2>
        <p class="muted">すべての回答記録を削除します。元に戻せません。</p>
        <button class="btn danger" id="reset">学習データをリセット</button>
      </section>`;

    document.getElementById('export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sekyu-backup-${dayKey(Date.now())}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById('import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.attempts)) throw new Error('形式が正しくありません');
        if (!confirm(`回答記録 ${data.attempts.length}件で、今のデータを置き換えますか？`)) return;
        state = { exam: EXAMS[data.exam] ? data.exam : state.exam, attempts: data.attempts };
        saveState();
        alert('復元しました');
        render();
      } catch (err) {
        alert(`復元できませんでした: ${err.message}`);
      }
    });

    document.getElementById('reset').addEventListener('click', () => {
      if (!confirm('すべての学習データを削除します。よろしいですか？')) return;
      state = { exam: state.exam, attempts: [] };
      saveState();
      quiz = null;
      location.hash = '#/';
    });
  }

  // ---------- ルーティング ----------
  function render() {
    const [path, query] = (location.hash.replace(/^#/, '') || '/').split('?');
    const params = new URLSearchParams(query || '');
    const routes = {
      '/': ['dashboard', renderDashboard],
      '/practice': ['practice', renderPractice],
      '/quiz': ['quiz', renderQuiz],
      '/review': ['review', renderReview],
      '/settings': ['settings', renderSettings],
    };
    const [name, fn] = routes[path] || routes['/'];
    if (name !== 'quiz' && quiz && quiz.index < quiz.items.length && quiz.results.length > 0) {
      // 演習の途中で他の画面へ移動したら破棄する（回答済みの記録は保存済み）
      quiz = null;
    }
    hideTooltip();
    renderHeader(name);
    fn(params);
  }

  window.addEventListener('hashchange', render);

  // キーボード操作（解答画面）
  document.addEventListener('keydown', (e) => {
    if (!quiz || !location.hash.startsWith('#/quiz') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (quiz.index >= quiz.items.length) return;
    if (quiz.chosen === null && /^[1-9]$/.test(e.key)) {
      choose(Number(e.key) - 1);
    } else if (quiz.chosen !== null && (e.key === 'ArrowRight' || (e.key === 'Enter' && document.activeElement?.id !== 'next'))) {
      e.preventDefault();
      nextQuestion();
    }
  });

  // ---------- ツールチップ ----------
  function showTooltip(target, x, y) {
    tooltip.textContent = target.dataset.tip;
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function hideTooltip() {
    tooltip.hidden = true;
  }
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) showTooltip(t, e.clientX, e.clientY);
    else hideTooltip();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) {
      const r = t.getBoundingClientRect();
      showTooltip(t, r.left + r.width / 2, r.top);
    }
  });
  document.addEventListener('focusout', hideTooltip);
  window.addEventListener('scroll', hideTooltip, { passive: true });

  render();
})();
