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

if (!token) {
  window.location.href = '/static/index.html';
} else if (role === 'human_agent') {
  window.location.href = '/static/agent-dashboard.html';
} else if (role !== 'company_admin') {
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
  const handleOk = () => { cleanup(); onConfirm(); };

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
    try { const json = await response.json(); return json.detail || fallback; } catch (_) {}
  }
  try { const text = await response.text(); return text.trim() || fallback; } catch (_) {}
  return fallback;
}

async function apiFetch(endpoint, options = {}) {
  const headers = { ...options.headers };
  headers['Authorization'] = `Bearer ${token}`;
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
document.addEventListener('DOMContentLoaded', loadAdminDashboard);

async function loadAdminDashboard() {
  try {
    const [profile, docs, agents] = await Promise.all([
      apiFetch('/company/profile'),
      apiFetch('/documents/list').catch(() => []),
      apiFetch('/company/agents').catch(() => [])
    ]);

    if (profile) {
      document.getElementById('admin-company-name').textContent = profile.name;
      document.getElementById('admin-company-email').textContent = profile.admin_email;
      document.getElementById('setCareEmail').value = profile.customer_care_email || '';
      if (profile.smtp_host) document.getElementById('setSmtpHost').value = profile.smtp_host;
      if (profile.smtp_port) document.getElementById('setSmtpPort').value = profile.smtp_port;
      if (profile.imap_host) document.getElementById('setImapHost').value = profile.imap_host;
      if (profile.imap_port) document.getElementById('setImapPort').value = profile.imap_port;
    }

    renderAdminDocs(docs);
    renderAdminAgents(agents);
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function renderAdminDocs(docs) {
  document.getElementById('admin-doc-count').textContent = docs.length;
  const listEl = document.getElementById('admin-doc-list');
  
  if (docs.length === 0) {
    listEl.innerHTML = `<div class="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-100 border-dashed">No policy documents uploaded yet.</div>`;
    return;
  }
  
  listEl.innerHTML = docs.map(doc => `
    <div class="flex justify-between items-center p-3 sm:p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors shadow-sm">
      <div class="flex items-center gap-3 overflow-hidden">
        <i data-lucide="file" class="w-5 h-5 text-slate-400 shrink-0"></i>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-900 truncate">${escapeHtml(doc.file_name)}</p>
          <p class="text-xs text-slate-500 mt-0.5">Uploaded ${new Date(doc.created_at).toLocaleDateString()}</p>
        </div>
      </div>
      <button class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0" onclick="deleteDocument(${doc.id})">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
  `).join('');
  refreshIcons();
}

function renderAdminAgents(agents) {
  document.getElementById('admin-agent-count').textContent = agents.length;
  const listEl = document.getElementById('admin-agent-list');
  
  if (agents.length === 0) {
    listEl.innerHTML = `<li class="p-6 text-center text-slate-500">No support agents registered yet.</li>`;
    return;
  }

  listEl.innerHTML = agents.map(agent => `
    <li class="p-4 sm:p-5 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex justify-center items-center font-bold text-xs">
          ${escapeHtml(agent.username.substring(0, 2).toUpperCase())}
        </div>
        <div>
          <p class="text-sm font-semibold text-slate-900">${escapeHtml(agent.username)}</p>
          <p class="text-xs text-slate-500">${escapeHtml(agent.email)}</p>
        </div>
      </div>
      <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${agent.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
        ${agent.is_active ? 'Active' : 'Inactive'}
      </span>
    </li>
  `).join('');
}

// Upload Actions
document.getElementById('docFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  showToast('Uploading document...', 'info');
  try {
    await apiFetch('/documents/upload', { method: 'POST', body: formData });
    showToast('Document uploaded successfully', 'success');
    e.target.value = '';
    const docs = await apiFetch('/documents/list');
    renderAdminDocs(docs);
  } catch (err) {
    showToast('Upload failed: ' + err.message, 'error');
  }
});

window.deleteDocument = (docId) => {
  showConfirm('Delete Document', 'Are you sure you want to delete this policy document? It will no longer be used for auto-resolution.', async () => {
    try {
      await apiFetch(`/documents/${docId}`, { method: 'DELETE' });
      showToast('Document deleted', 'success');
      const docs = await apiFetch('/documents/list');
      renderAdminDocs(docs);
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  });
};

// Settings Update
document.getElementById('form-admin-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFetch('/company/settings', {
      method: 'POST',
      body: {
        customer_care_email: document.getElementById('setCareEmail').value,
        smtp_host: document.getElementById('setSmtpHost').value,
        smtp_port: parseInt(document.getElementById('setSmtpPort').value) || 587,
        imap_host: document.getElementById('setImapHost').value,
        imap_port: parseInt(document.getElementById('setImapPort').value) || 993
      }
    });
    showToast('Settings saved successfully', 'success');
  } catch (err) {
    showToast('Update failed: ' + err.message, 'error');
  }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
  showConfirm('Log Out', 'Are you sure you want to log out of your session?', () => {
    localStorage.clear();
    window.location.href = '/static/index.html';
  });
});