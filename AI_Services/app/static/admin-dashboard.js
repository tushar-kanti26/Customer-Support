// ==================== GLOBAL STATE ====================
const token = localStorage.getItem('cc_token');
const role = localStorage.getItem('cc_role');
const companyId = localStorage.getItem('cc_company_id');

const API_BASE = '/api';

// Redirect to login if not authenticated as company_admin
if (!token || role !== 'company_admin') {
  window.location.href = '/static/index.html';
}

// ==================== PAGE INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  loadCompanyDashboard();
});

// ==================== LOAD DASHBOARD DATA ====================
async function loadCompanyDashboard() {
  try {
    const response = await fetch(`${API_BASE}/company/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('companyTitle').textContent = `${profile.name}`;
      document.getElementById('companyEmail').textContent = profile.admin_email;
      
      loadCompanyDocuments();
      loadCompanyAgents();
      loadEmailSettings();
    } else {
      showError('Failed to load company profile');
    }
  } catch (err) {
    showError('Error: ' + err.message);
  }
}

// ==================== LOAD DOCUMENTS ====================
async function loadCompanyDocuments() {
  try {
    const response = await fetch(`${API_BASE}/documents/list`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const docs = await response.json();
      document.getElementById('docCount').textContent = docs.length;
      const listEl = document.getElementById('documentsList');
      
      if (docs.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No documents yet. Upload your first policy document above.</p>';
        return;
      }
      
      listEl.innerHTML = docs.map(doc => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-name">📄 ${doc.file_name}</div>
            <div class="item-date">${new Date(doc.created_at).toLocaleDateString()}</div>
          </div>
          <button class="btn-delete" onclick="deleteDocument(${doc.id})">Delete</button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

async function parseApiError(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const errorJson = await response.json();
      if (errorJson && typeof errorJson.detail === 'string' && errorJson.detail.trim()) {
        return errorJson.detail;
      }
    } catch (_) {
      // Fall back to text parsing below when JSON is malformed.
    }
  }

  try {
    const text = await response.text();
    if (text && text.trim()) {
      return text;
    }
  } catch (_) {
    // Ignore parse failure and return fallback.
  }

  return fallbackMessage;
}

// ==================== UPLOAD DOCUMENT ====================
document.getElementById('fileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  const statusEl = document.getElementById('uploadStatus');
  
  try {
    const response = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (response.ok) {
      statusEl.textContent = '✅ Document uploaded successfully!';
      statusEl.className = 'status-message success';
      document.getElementById('fileInput').value = '';
      loadCompanyDocuments();
      setTimeout(() => {
        statusEl.textContent = '';
      }, 3000);
    } else {
      const errorMessage = await parseApiError(response, 'Upload failed');
      statusEl.textContent = '❌ ' + errorMessage;
      statusEl.className = 'status-message error';
    }
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
    statusEl.className = 'status-message error';
  }
});

// ==================== DELETE DOCUMENT ====================
async function deleteDocument(docId) {
  if (!confirm('Delete this document?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/documents/${docId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadCompanyDocuments();
    } else {
      alert('Delete failed');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ==================== LOAD AGENTS ====================
async function loadCompanyAgents() {
  try {
    const response = await fetch(`${API_BASE}/company/agents`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const agents = await response.json();
      document.getElementById('agentCount').textContent = agents.length;
      const listEl = document.getElementById('agentsList');
      
      if (agents.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No agents registered yet. They\'ll appear here when they sign up.</p>';
        return;
      }
      
      listEl.innerHTML = agents.map(agent => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-name">👤 ${agent.username}</div>
            <div class="item-email">${agent.email}</div>
          </div>
          <span class="badge ${agent.is_active ? 'active' : 'inactive'}">
            ${agent.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load agents:', err);
  }
}

// ==================== LOAD EMAIL SETTINGS ====================
async function loadEmailSettings() {
  try {
    const response = await fetch(`${API_BASE}/company/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('settingsCareEmail').value = profile.customer_care_email;
      // Note: API doesn't return SMTP/IMAP settings for security reasons
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// ==================== UPDATE SETTINGS ====================
document.getElementById('updateSettingsBtn')?.addEventListener('click', async () => {
  const updates = {
    customer_care_email: document.getElementById('settingsCareEmail').value,
    smtp_host: document.getElementById('settingsSmtpHost').value,
    smtp_port: parseInt(document.getElementById('settingsSmtpPort').value) || 587,
    imap_host: document.getElementById('settingsImapHost').value,
    imap_port: parseInt(document.getElementById('settingsImapPort').value) || 993
  };
  
  try {
    const response = await fetch(`${API_BASE}/company/settings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });
    
    const statusEl = document.getElementById('settingsStatus');
    if (response.ok) {
      statusEl.textContent = '✅ Settings updated successfully!';
      statusEl.className = 'status-message success';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 3000);
    } else {
      const errorMessage = await parseApiError(response, 'Update failed');
      statusEl.textContent = '❌ ' + errorMessage;
      statusEl.className = 'status-message error';
    }
  } catch (err) {
    const statusEl = document.getElementById('settingsStatus');
    statusEl.textContent = '❌ ' + err.message;
    statusEl.className = 'status-message error';
  }
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
