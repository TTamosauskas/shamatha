(() => {
  'use strict';

  const PAGE_SIZE = 5;
  const tbody = document.getElementById('usersBody');
  const search = document.getElementById('userSearch');
  const previous = document.getElementById('userPagePrev');
  const next = document.getElementById('userPageNext');
  const label = document.getElementById('userPageLabel');
  if (!tbody || !search || !previous || !next || !label) return;

  let page = 1;
  let scheduled = false;

  function userRows() {
    return [...tbody.querySelectorAll('tr')].filter(row => row.querySelector('.user-email-cell'));
  }

  function apply() {
    const rows = userRows();
    const query = String(search.value || '').trim().toLocaleLowerCase('pt-BR');
    const filtered = rows.filter(row => {
      const email = String(row.querySelector('.user-email-cell')?.textContent || '').trim().toLocaleLowerCase('pt-BR');
      return !query || email.includes(query);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(Math.max(1, page), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filtered.length);
    const visible = new Set(filtered.slice(start, end));

    rows.forEach(row => { row.style.display = visible.has(row) ? '' : 'none'; });

    const emptyRow = [...tbody.querySelectorAll('tr')].find(row => !row.querySelector('.user-email-cell'));
    if (emptyRow) emptyRow.style.display = rows.length ? 'none' : '';

    if (!filtered.length && rows.length) label.textContent = 'Nenhum usuário encontrado';
    else if (!filtered.length) label.textContent = '0 usuários';
    else label.textContent = `${start + 1}–${end} de ${filtered.length}`;

    previous.disabled = page <= 1 || !filtered.length;
    next.disabled = page >= totalPages || !filtered.length;
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      apply();
    });
  }

  search.addEventListener('input', () => {
    page = 1;
    apply();
  });

  previous.addEventListener('click', () => {
    page = Math.max(1, page - 1);
    apply();
  });

  next.addEventListener('click', () => {
    page += 1;
    apply();
  });

  new MutationObserver(scheduleApply).observe(tbody, { childList:true, subtree:true });
  apply();
})();
