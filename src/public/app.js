// CC Dashboard — Client-side JS ("Terminal Noir" theme)

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(ts);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

function formatCompact(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── Configure marked to prevent XSS ────────────────────
if (typeof marked !== 'undefined') {
  marked.use({
    renderer: {
      html(token) {
        return escapeHtml(token.text || token.raw || '');
      }
    }
  });
}

// ─── Metrics ────────────────────────────────────────────
function loadMetrics() {
  fetch('/api/metrics')
    .then(res => res.json())
    .then(data => {
      // Navbar globalStats
      const gs = document.getElementById('globalStats');
      if (gs) {
        gs.textContent = `${formatCompact(data.totalConversations)} convos / ${formatBytes(data.totalSize)} / ~${formatCompact(data.estimatedTokens)} tokens`;
      }

      // Metric cards
      const mc = document.getElementById('metricConversations');
      const ms = document.getElementById('metricStorage');
      const mm = document.getElementById('metricMessages');
      const mt = document.getElementById('metricTokens');
      if (mc) mc.textContent = formatCompact(data.totalConversations);
      if (ms) ms.textContent = formatBytes(data.totalSize);
      if (mm) mm.textContent = formatCompact(data.totalMessages);
      if (mt) mt.textContent = '~' + formatCompact(data.estimatedTokens);

      // Project breakdown
      const pb = document.getElementById('projectBreakdown');
      if (pb && data.byProject && data.byProject.length > 0) {
        pb.innerHTML = data.byProject.map(p =>
          `<span class="project-stat"><span class="project-stat-name">${escapeHtml(p.project)}</span>: ${p.count} (${formatBytes(p.size)})</span>`
        ).join('');
      }
    })
    .catch(() => {});
}

// ─── Conversation List Page ─────────────────────────────
const listEl = document.getElementById('conversationList');
if (listEl) {
  let currentPage = 1;
  let selected = new Set();
  let allMatchingMode = false;  // true = bulk delete uses filter params, not IDs
  let lastTotal = 0;            // total matching conversations from last API response
  let visibleSessionIds = [];   // session IDs currently visible on the page

  async function loadConversations() {
    const search = document.getElementById('searchInput').value;
    const project = document.getElementById('projectFilter').value;
    const params = new URLSearchParams({ page: currentPage, limit: 50 });
    if (search) params.set('search', search);
    if (project) params.set('project', project);

    const res = await fetch(`/api/conversations?${params}`);
    const data = await res.json();
    renderList(data);
  }

  function renderList(data) {
    const { conversations, total, page, totalPages } = data;
    lastTotal = total;
    visibleSessionIds = conversations.map(c => c.sessionId);

    // Stats bar
    document.getElementById('statsBar').innerHTML =
      `<span>${total} conversations</span>` +
      `<span style="margin: 0 8px; opacity: 0.3">/</span>` +
      `<span>page ${page} of ${totalPages || 1}</span>`;

    // Render rows
    listEl.innerHTML = conversations.map((c, i) => `
      <div class="conv-row ${selected.has(c.sessionId) ? 'selected' : ''}"
        data-session="${c.sessionId}" data-project="${c.projectDir}"
        style="animation-delay: ${i * 20}ms; animation: convRowIn 0.25s ease-out both ${i * 20}ms">
        <input type="checkbox" class="row-checkbox" ${selected.has(c.sessionId) ? 'checked' : ''}
          data-session="${c.sessionId}" data-project="${c.projectDir}"
          onclick="event.stopPropagation(); toggleSelect('${c.sessionId}', this.closest('.conv-row'))">
        <div style="flex:1; min-width:0" onclick="window.location='/conversation/${c.projectDir}/${c.sessionId}'">
          <div class="conv-meta">
            <span class="conv-project">${c.projectDir}</span>
            <span class="conv-date">${relativeTime(c.timestamp)}</span>
            <span class="conv-size">${formatBytes(c.fileSize)}</span>
          </div>
          <div class="conv-preview">${escapeHtml(c.display || '(empty)')}</div>
        </div>
        <div class="conv-actions">
          <a href="/api/conversations/${c.projectDir}/${c.sessionId}/export?format=json"
            class="action-btn" title="Export JSON" onclick="event.stopPropagation()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
          <button class="action-btn delete-btn" title="Delete"
            onclick="event.stopPropagation(); deleteSingle('${c.projectDir}', '${c.sessionId}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    // Pagination
    const pagEl = document.getElementById('pagination');
    if (totalPages > 1) {
      let html = '';
      if (page > 1) html += `<button onclick="goPage(${page - 1})" class="page-btn">&larr; Prev</button>`;
      html += `<span class="page-info">${page} / ${totalPages}</span>`;
      if (page < totalPages) html += `<button onclick="goPage(${page + 1})" class="page-btn">Next &rarr;</button>`;
      pagEl.innerHTML = html;
    } else {
      pagEl.innerHTML = '';
    }

    updateBulkBtn();
    updateSelectAllState();
  }

  window.goPage = function(p) { currentPage = p; loadConversations(); };

  window.toggleSelect = function(sid, row) {
    if (selected.has(sid)) {
      selected.delete(sid);
      row?.classList.remove('selected');
      // Exit all-matching mode when any row is unchecked
      if (allMatchingMode) {
        allMatchingMode = false;
      }
    } else {
      selected.add(sid);
      row?.classList.add('selected');
    }
    updateBulkBtn();
    updateSelectAllState();
  };

  function updateBulkBtn() {
    const btn = document.getElementById('bulkDeleteBtn');
    const cnt = document.getElementById('selectedCount');
    const displayCount = allMatchingMode ? lastTotal : selected.size;
    if (displayCount > 0) {
      btn.classList.remove('hidden');
      cnt.textContent = displayCount;
    } else {
      btn.classList.add('hidden');
    }
  }

  // ─── Select All Logic ───────────────────────────────────
  const selectAllCb = document.getElementById('selectAllCheckbox');
  const bannerEl = document.getElementById('selectionBanner');

  selectAllCb.addEventListener('change', () => {
    if (selectAllCb.checked) {
      // Select all visible rows on current page
      visibleSessionIds.forEach(sid => {
        selected.add(sid);
        const row = document.querySelector(`[data-session="${sid}"]`);
        row?.classList.add('selected');
        const cb = row?.querySelector('.row-checkbox');
        if (cb) cb.checked = true;
      });
    } else {
      // Deselect everything
      clearSelection();
    }
    updateBulkBtn();
    updateSelectAllState();
  });

  function clearSelection() {
    selected.clear();
    allMatchingMode = false;
    document.querySelectorAll('.conv-row.selected').forEach(r => r.classList.remove('selected'));
    document.querySelectorAll('.row-checkbox:checked').forEach(cb => { cb.checked = false; });
    updateBulkBtn();
    updateSelectAllState();
  }

  window.selectAllMatching = function() {
    allMatchingMode = true;
    updateBulkBtn();
    updateSelectAllState();
  };

  window.clearAllSelection = function() {
    clearSelection();
  };

  function updateSelectAllState() {
    const visibleCount = visibleSessionIds.length;
    if (visibleCount === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      bannerEl.classList.add('hidden');
      return;
    }

    const selectedOnPage = visibleSessionIds.filter(sid => selected.has(sid)).length;

    // Update checkbox state
    if (selectedOnPage === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    } else if (selectedOnPage === visibleCount) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    }

    // Update banner
    if (allMatchingMode) {
      bannerEl.classList.remove('hidden');
      bannerEl.innerHTML =
        `<span>All <strong>${lastTotal}</strong> conversations matching this filter are selected.</span>` +
        `<a href="#" onclick="event.preventDefault(); clearAllSelection()">Clear selection</a>`;
    } else if (selectedOnPage === visibleCount && lastTotal > visibleCount) {
      bannerEl.classList.remove('hidden');
      bannerEl.innerHTML =
        `<span>All <strong>${selectedOnPage}</strong> on this page selected.</span> ` +
        `<a href="#" onclick="event.preventDefault(); selectAllMatching()">Select all ${lastTotal} matching this filter?</a>` +
        `<span style="margin: 0 6px; opacity: 0.3">|</span>` +
        `<a href="#" onclick="event.preventDefault(); clearAllSelection()">Clear selection</a>`;
    } else if (selected.size > 0) {
      bannerEl.classList.remove('hidden');
      bannerEl.innerHTML =
        `<span><strong>${selected.size}</strong> selected.</span> ` +
        `<a href="#" onclick="event.preventDefault(); clearAllSelection()">Clear selection</a>`;
    } else {
      bannerEl.classList.add('hidden');
    }
  }

  window.deleteSingle = async function(proj, sid) {
    if (!confirm('Delete this conversation permanently?')) return;
    const res = await fetch(`/api/conversations/${proj}/${sid}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Deleted — freed ${formatBytes(data.freedBytes)}`);
      selected.delete(sid);
      allMatchingMode = false;
      loadConversations();
    } else {
      showToast('Failed to delete', 'error');
    }
  };

  document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
    const count = allMatchingMode ? lastTotal : selected.size;
    if (!confirm(`Delete ${count} conversation${count > 1 ? 's' : ''}? This cannot be undone.`)) return;

    if (allMatchingMode) {
      // Use filter-based bulk delete API
      const search = document.getElementById('searchInput').value;
      const project = document.getElementById('projectFilter').value;
      const body = {};
      if (search) body.search = search;
      if (project) body.project = project;
      // If no filters active, send all visible IDs as fallback
      if (!search && !project) {
        body.sessionIds = Array.from(selected);
      }
      const res = await fetch('/api/conversations/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Deleted ${data.deletedCount} — freed ${formatBytes(data.freedBytes)}`);
      } else {
        showToast('Bulk delete failed', 'error');
      }
    } else {
      // Use bulk delete with specific session IDs
      const sessionIds = Array.from(selected);
      const res = await fetch('/api/conversations/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Deleted ${data.deletedCount} — freed ${formatBytes(data.freedBytes)}`);
      } else {
        showToast('Bulk delete failed', 'error');
      }
    }

    selected.clear();
    allMatchingMode = false;
    loadConversations();
  });

  // Debounced search
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      allMatchingMode = false;
      selected.clear();
      loadConversations();
    }, 300);
  });
  document.getElementById('projectFilter').addEventListener('change', () => {
    currentPage = 1;
    allMatchingMode = false;
    selected.clear();
    loadConversations();
  });

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
    }
  });

  loadConversations();
  loadMetrics();
}

// ─── Detail Page ────────────────────────────────────────
const msgListEl = document.getElementById('messageList');
if (msgListEl) {
  const project = msgListEl.dataset.project;
  const sessionId = msgListEl.dataset.session;

  async function loadMessages() {
    const res = await fetch(`/api/conversations/${project}/${sessionId}`);
    const messages = await res.json();
    renderMessages(messages);
  }

  function renderMessages(messages) {
    msgListEl.innerHTML = messages.map((m, i) => {
      const delay = Math.min(i * 30, 500);

      if (m.role === 'user') {
        return `
          <div class="msg-user" style="animation-delay: ${delay}ms">
            <div class="msg-user-inner">
              <div class="msg-user-label">You</div>
              <div class="msg-user-text">${escapeHtml(m.content)}</div>
            </div>
          </div>`;
      } else {
        let thinkingHtml = '';
        if (m.thinking) {
          thinkingHtml = `
            <details class="thinking-block">
              <summary class="thinking-summary">Thinking process</summary>
              <div class="thinking-content">${escapeHtml(m.thinking)}</div>
            </details>`;
        }
        const rendered = typeof marked !== 'undefined' ? marked.parse(m.content || '') : escapeHtml(m.content);
        return `
          <div class="msg-assistant" style="animation-delay: ${delay}ms">
            <div class="msg-assistant-inner">
              <div class="msg-assistant-label">Claude</div>
              ${thinkingHtml}
              <div class="msg-content">${rendered}</div>
            </div>
          </div>`;
      }
    }).join('');
  }

  loadMessages();
}

// ─── Row entrance animation (CSS injected) ──────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes convRowIn {
    from { opacity: 0; transform: translateX(-6px); }
    to { opacity: 1; transform: translateX(0); }
  }
`;
document.head.appendChild(style);
