// ==================== ICONS INIT ====================
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

refreshIcons();

// ==================== GLOBAL STATE & API ====================
const API_BASE = '/api';
const token = localStorage.getItem('cc_token');
const role = localStorage.getItem('cc_role');
let activeTicketFilter = 'unresolved';

if (!token) {
  window.location.href = '/static/index.html';
} else if (role === 'company_admin') {
  window.location.href = '/static/admin-dashboard.html';
} else if (role !== 'human_agent') {
  window.location.href = '/static/index.html';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-green-50 text-green-800 border-green-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200'
  };

  const iconPaths = {
    success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>',
    error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>',
    info: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
  };

  toast.className = `flex items-start gap-3 p-4 rounded-xl border shadow-lg shadow-slate-200/50 transform transition-all duration-300 translate-x-full opacity-0 ${colors[type]}`;
  toast.innerHTML = `
    <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">${iconPaths[type]}</svg>
    <p class="text-sm font-medium leading-relaxed">${message}</p>
    <button class="ml-auto text-slate-400 hover:text-slate-600 transition-colors" onclick="this.parentElement.remove()">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
    </button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.remove('translate-x-full', 'opacity-0'));
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-full');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function showConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const btnCancel = document.getElementById('confirm-cancel');
  const btnOk = document.getElementById('confirm-ok');

  if (!modal || !titleEl || !messageEl || !btnCancel || !btnOk) {
    if (window.confirm(message)) onConfirm();
    return;
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  modal.classList.remove('hidden');

  const cleanup = () => {
    modal.classList.add('hidden');
    btnCancel.removeEventListener('click', handleCancel);
    btnOk.removeEventListener('click', handleOk);
  };

  const handleCancel = () => cleanup();
  const handleOk = () => {
    cleanup();
    onConfirm();
  };

  btnCancel.addEventListener('click', handleCancel);
  btnOk.addEventListener('click', handleOk);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function parseApiError(response, fallback = 'An error occurred') {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const json = await response.json();
      return json.detail || fallback;
    } catch (_) {
      // Ignore malformed JSON and fall back to text.
    }
  }

  try {
    const text = await response.text();
    return text.trim() || fallback;
  } catch (_) {
    return fallback;
  }
}

async function apiFetch(endpoint, options = {}) {
  const headers = { ...options.headers, Authorization: `Bearer ${token}` };

  if (!(options.body instanceof FormData) && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.clear();
      window.location.href = '/static/index.html';
    }

    const errorMsg = await parseApiError(response, `Request failed: ${response.status}`);
    throw new Error(errorMsg);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  return null;
}

// ==================== DASHBOARD LOGIC ====================
document.addEventListener('DOMContentLoaded', async () => {
  bindFilterButtons();
  bindActions();
  await loadAgentDashboard();
});

function bindActions() {
  const refreshBtn = document.getElementById('btn-agent-refresh');
  const logoutBtn = document.getElementById('logoutBtn');

  refreshBtn?.addEventListener('click', async () => {
    await syncInboxAndRefresh();
  });

  logoutBtn?.addEventListener('click', () => {
    showConfirm('Log Out', 'Are you sure you want to log out of your session?', () => {
      localStorage.clear();
      window.location.href = '/static/index.html';
    });
  });
}

function bindFilterButtons() {
  const filterContainer = document.getElementById('ticket-filters');
  if (!filterContainer) return;

  filterContainer.addEventListener('click', async (event) => {
    const button = event.target.closest('.ticket-filter-btn');
    if (!button) return;

    const newFilter = button.dataset.filter;
    if (!newFilter || newFilter === activeTicketFilter) return;

    activeTicketFilter = newFilter;
    updateFilterButtonState();
    await loadTickets();
  });
}

function updateFilterButtonState() {
  document.querySelectorAll('.ticket-filter-btn').forEach((button) => {
    const isActive = button.dataset.filter === activeTicketFilter;
    button.classList.toggle('bg-white', isActive);
    button.classList.toggle('text-slate-900', isActive);
    button.classList.toggle('shadow-sm', isActive);
    button.classList.toggle('text-slate-600', !isActive);
  });
}

async function loadAgentDashboard() {
  try {
    const user = await apiFetch('/auth/me');
    if (user) {
      const userNameEl = document.getElementById('agent-user-name');
      if (userNameEl) userNameEl.textContent = `Welcome, ${user.username}`;
    }

    await syncInboxAndRefresh(false);
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

async function syncInboxAndRefresh(showSyncToast = true) {
  const statusEl = document.getElementById('agent-sync-status');
  if (statusEl) statusEl.textContent = 'Syncing inbox...';

  try {
    const pollResult = await apiFetch('/ingest/poll', { method: 'POST' });
    if (showSyncToast && pollResult) {
      showToast(
        `Synced ${pollResult.processed || 0} email(s). ${pollResult.auto_resolved || 0} auto-resolved, ${pollResult.escalated || 0} escalated.`,
        'info'
      );
    }
  } catch (err) {
    showToast('Inbox sync failed: ' + err.message, 'error');
  }

  await loadTickets();
}

function viewTitleForFilter(filter) {
  if (filter === 'replied') return 'Replied Tickets';
  if (filter === 'all') return 'All Tickets';
  return 'Unresolved Tickets';
}

function filterTickets(tickets) {
  if (activeTicketFilter === 'replied') {
    return tickets.filter((t) => t.status === 'resolved' && t.reply_sent_by);
  }
  if (activeTicketFilter === 'all') {
    return tickets;
  }
  return tickets.filter((t) => t.status !== 'resolved');
}

async function loadTickets() {
  const titleEl = document.getElementById('agent-view-title');
  const statusEl = document.getElementById('agent-sync-status');

  if (titleEl) titleEl.textContent = viewTitleForFilter(activeTicketFilter);

  try {
    const tickets = await apiFetch('/tickets?status=all');
    const unresolvedCount = tickets.filter((t) => t.status !== 'resolved').length;
    const repliedCount = tickets.filter((t) => t.status === 'resolved' && t.reply_sent_by).length;

    if (statusEl) {
      statusEl.textContent = `${unresolvedCount} unresolved | ${repliedCount} replied`;
    }

    renderTickets(filterTickets(tickets));
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Failed to load tickets';
    showToast('Failed to load tickets: ' + err.message, 'error');
  }
}

function renderTickets(tickets) {
  const container = document.getElementById('agent-ticket-list');
  if (!container) return;

  if (tickets.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-white border border-slate-200 rounded-xl">
        <p class="text-slate-600 font-medium">No tickets in this view.</p>
        <p class="text-sm text-slate-500 mt-2">Try another filter or sync inbox for new messages.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = tickets
    .map((ticket) => {
      const statusClass =
        ticket.status === 'resolved'
          ? 'bg-green-100 text-green-800'
          : ticket.status === 'in_progress'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-amber-100 text-amber-800';

      return `
        <article class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div class="flex flex-wrap justify-between gap-3 items-start">
            <div>
              <h3 class="text-base sm:text-lg font-semibold text-slate-900">${escapeHtml(ticket.subject || '(No Subject)')}</h3>
              <p class="text-xs text-slate-500 mt-1">Ticket #${ticket.id} | ${escapeHtml(ticket.sender_email || 'Unknown sender')}</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${statusClass}">
              ${escapeHtml(ticket.status || 'open')}
            </span>
          </div>

          <div class="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Customer Message</p>
            <p class="text-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(ticket.body || '')}</p>
          </div>

          <div class="mt-3 text-sm text-slate-600 space-y-1">
            <p><span class="font-medium text-slate-700">Reason:</span> ${escapeHtml(ticket.reason || 'N/A')}</p>
            ${ticket.resolution_note ? `<p><span class="font-medium text-slate-700">Resolution:</span> ${escapeHtml(ticket.resolution_note)}</p>` : ''}
            ${ticket.replied_at ? `<p><span class="font-medium text-slate-700">Replied at:</span> ${new Date(ticket.replied_at).toLocaleString()}</p>` : ''}
            ${ticket.reply_sent_by ? `<p><span class="font-medium text-slate-700">Replied by:</span> ${escapeHtml(ticket.reply_sent_by)}</p>` : ''}
          </div>

          ${
            ticket.status !== 'resolved'
              ? `
            <form class="resolve-form mt-4" data-ticket-id="${ticket.id}">
              <label class="block text-sm font-medium text-slate-700 mb-1" for="note_${ticket.id}">Resolution note</label>
              <textarea id="note_${ticket.id}" class="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" rows="3" placeholder="Write what was done to resolve this ticket..." required></textarea>
              <button type="submit" class="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
                <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                Mark as Resolved
              </button>
            </form>
          `
              : ''
          }
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('.resolve-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ticketId = form.dataset.ticketId;
      const noteInput = form.querySelector('textarea');
      const note = noteInput.value.trim();

      if (!note) {
        showToast('Please provide a resolution note.', 'error');
        return;
      }

      await markTicketResolved(ticketId, note);
    });
  });

  refreshIcons();
}

async function markTicketResolved(ticketId, resolutionNote) {
  try {
    await apiFetch(`/tickets/${ticketId}`, {
      method: 'PATCH',
      body: {
        status: 'resolved',
        resolution_note: resolutionNote
      }
    });

    showToast('Ticket resolved and customer notified.', 'success');
    await loadTickets();
  } catch (err) {
    showToast('Failed to resolve ticket: ' + err.message, 'error');
  }
}
