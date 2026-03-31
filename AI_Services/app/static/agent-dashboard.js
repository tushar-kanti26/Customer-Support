// ==================== GLOBAL STATE ====================
const token = localStorage.getItem('cc_token');
const role = localStorage.getItem('cc_role');
const companyId = localStorage.getItem('cc_company_id');
let activeTicketFilter = 'unresolved';

const API_BASE = '/api';

// Redirect to login if not authenticated as human_agent
if (!token || role !== 'human_agent') {
  window.location.href = '/static/index.html';
}

// ==================== PAGE INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  bindTicketFilters();
  loadAgentDashboard();
});

// ==================== LOAD AGENT DASHBOARD ====================
async function loadAgentDashboard() {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const user = await response.json();
      document.getElementById('agentName').textContent = `Welcome, ${user.username}`;
      await pollInbox();
      loadTickets(activeTicketFilter);
    } else {
      showError('Failed to load agent info');
    }
  } catch (err) {
    showError('Error: ' + err.message);
  }
}

async function parseApiError(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json();
      if (payload && typeof payload.detail === 'string' && payload.detail.trim()) {
        return payload.detail;
      }
    } catch (_) {
      // Fall back to raw text.
    }
  }

  try {
    const text = await response.text();
    if (text && text.trim()) {
      return text;
    }
  } catch (_) {
    // Ignore and use fallback.
  }

  return fallbackMessage;
}

async function pollInbox() {
  try {
    const response = await fetch(`${API_BASE}/ingest/poll`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const err = await parseApiError(response, 'Failed to poll inbox');
      showError(err);
      return;
    }

    const result = await response.json();
    const statusEl = document.getElementById('ticketStatus');
    if (statusEl && result.processed > 0) {
      statusEl.textContent = `Synced ${result.processed} email(s): ${result.auto_resolved} auto-resolved, ${result.escalated} escalated`;
    }
  } catch (err) {
    showError('Inbox poll error: ' + err.message);
  }
}

// ==================== LOAD TICKETS ====================
function bindTicketFilters() {
  const container = document.getElementById('ticketFilters');
  if (!container) return;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;

    const filter = button.dataset.filter;
    if (!filter || filter === activeTicketFilter) return;

    activeTicketFilter = filter;
    setActiveFilterButton();
    loadTickets(activeTicketFilter);
  });
}

function setActiveFilterButton() {
  document.querySelectorAll('.ticket-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === activeTicketFilter);
  });
}

function filterTicketsForView(tickets, view) {
  if (view === 'replied') {
    return tickets.filter(ticket => ticket.status === 'resolved' && ticket.reply_sent_by);
  }
  if (view === 'all') {
    return tickets;
  }
  return tickets.filter(ticket => ticket.status !== 'resolved');
}

function getSectionTitle(view) {
  if (view === 'replied') return 'Replied Tickets';
  if (view === 'all') return 'All Tickets';
  return 'Unresolved Tickets';
}

async function loadTickets(view = activeTicketFilter) {
  try {
    const response = await fetch(`${API_BASE}/tickets?status=all`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const tickets = await response.json();
      const container = document.getElementById('ticketsContainer');
      const statusEl = document.getElementById('ticketStatus');
      const titleEl = document.getElementById('ticketSectionTitle');

      const unresolvedTickets = tickets.filter(ticket => ticket.status !== 'resolved');
      const repliedTickets = tickets.filter(ticket => ticket.status === 'resolved' && ticket.reply_sent_by);
      const visibleTickets = filterTicketsForView(tickets, view);

      if (titleEl) {
        titleEl.textContent = getSectionTitle(view);
      }

      if (tickets.length === 0) {
        statusEl.textContent = 'No tickets yet';
        container.innerHTML = '<p class="empty-state">No tickets available for this company yet.</p>';
        return;
      }

      const statusParts = [];
      statusParts.push(`${unresolvedTickets.length} unresolved ticket(s)`);
      if (repliedTickets.length > 0) {
        statusParts.push(`${repliedTickets.length} replied by email`);
      }
      statusEl.textContent = statusParts.join(' | ');

      if (visibleTickets.length === 0) {
        if (view === 'replied') {
          container.innerHTML = '<p class="empty-state">No replied tickets yet.</p>';
        } else if (view === 'all') {
          container.innerHTML = '<p class="empty-state">No tickets to show.</p>';
        } else {
          container.innerHTML = '<p class="empty-state">Great job! No unresolved tickets at the moment.</p>';
        }
        return;
      }

      container.innerHTML = visibleTickets.map(ticket => `
        <div class="ticket-card">
          <div class="ticket-top">
            <div class="ticket-title">
              <h3>${ticket.subject}</h3>
              <span class="ticket-id">#${ticket.id}</span>
            </div>
            <span class="ticket-status ${ticket.status}">${ticket.status.toUpperCase()}</span>
          </div>
          
          <div class="ticket-body">
            <p><strong>From:</strong> <span class="email-link">${ticket.sender_email}</span></p>
            <div class="message-box">
              <strong>Message:</strong>
              <p>${escapeHtml(ticket.body)}</p>
            </div>
            <p><strong>Reason:</strong> ${ticket.reason}</p>
            ${ticket.resolution_note ? `<p><strong>Previous Resolution:</strong> ${ticket.resolution_note}</p>` : ''}
            ${ticket.replied_at ? `<p><strong>Replied At:</strong> ${new Date(ticket.replied_at).toLocaleString()}</p>` : ''}
            ${ticket.reply_sent_by ? `<p><strong>Reply Sent By:</strong> ${ticket.reply_sent_by}</p>` : ''}
          </div>

          ${ticket.status !== 'resolved' ? `
            <div class="ticket-actions">
              <textarea class="resolution-note" id="note_${ticket.id}" placeholder="Enter resolution note..."></textarea>
              <button class="btn-resolve" onclick="markTicketResolved(${ticket.id})">Mark as Resolved</button>
            </div>
          ` : ''}
        </div>
      `).join('');
    } else {
      showError('Failed to load tickets');
    }
  } catch (err) {
    showError('Error: ' + err.message);
  }
}

// ==================== MARK TICKET AS RESOLVED ====================
async function markTicketResolved(ticketId) {
  const resolutionNote = document.getElementById(`note_${ticketId}`).value.trim();
  
  if (!resolutionNote) {
    alert('Please enter a resolution note');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'resolved',
        resolution_note: resolutionNote
      })
    });
    
    if (response.ok) {
      alert('✅ Ticket resolved and customer notified!');
      loadTickets(activeTicketFilter);
    } else {
      alert('Failed to update ticket');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ==================== REFRESH TICKETS ====================
document.getElementById('refreshBtn')?.addEventListener('click', async () => {
  await pollInbox();
  loadTickets(activeTicketFilter);
});

// ==================== LOGOUT ====================
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  if (!confirm('Logout?')) return;
  
  localStorage.removeItem('cc_token');
  localStorage.removeItem('cc_role');
  localStorage.removeItem('cc_company_id');
  
  window.location.href = '/static/index.html';
});

// ==================== HELPER FUNCTIONS ====================
function showError(message) {
  console.error(message);
  alert(message);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
