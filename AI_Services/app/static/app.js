// ==================== GLOBAL STATE ====================
let token = localStorage.getItem('cc_token');
let role = localStorage.getItem('cc_role');
let companyId = localStorage.getItem('cc_company_id');

const API_BASE = '/api';

// ==================== DOM ELEMENTS ====================
const loginPanel = document.getElementById('loginPanel');
const companyDashboard = document.getElementById('companyDashboard');
const agentDashboard = document.getElementById('agentDashboard');

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = e.target.getAttribute('data-tab');
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  // Hide all buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  // Show selected tab and button
  const selectedTab = document.getElementById(tabName);
  const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (selectedTab) selectedTab.classList.add('active');
  if (selectedBtn) selectedBtn.classList.add('active');
}

// ==================== COMPANY ADMIN FUNCTIONS ====================

// Company Registration
document.getElementById('companyRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const companyData = {
    company_name: document.getElementById('companyName').value,
    admin_email: document.getElementById('adminEmail').value,
    admin_username: document.getElementById('adminUsername').value,
    admin_password: document.getElementById('adminPassword').value,
    customer_care_email: document.getElementById('customerCareEmail').value,
    customer_care_app_password: document.getElementById('emailAppPassword').value,
    imap_host: document.getElementById('imapHost').value,
    imap_port: parseInt(document.getElementById('imapPort').value),
    smtp_host: document.getElementById('smtpHost').value,
    smtp_port: parseInt(document.getElementById('smtpPort').value),
    smtp_use_tls: true
  };
  
  try {
    const response = await fetch(`${API_BASE}/company/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(companyData)
    });
    
    const errorEl = document.getElementById('companyRegisterError');
    if (response.ok) {
      alert('✅ Company registered successfully! Please login with your credentials.');
      document.getElementById('companyRegisterForm').reset();
      switchTab('company-login');
    } else {
      const error = await response.json();
      errorEl.textContent = error.detail || 'Registration failed';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    const errorEl = document.getElementById('companyRegisterError');
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

// Company Admin Login
document.getElementById('companyLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const loginData = {
    email: document.getElementById('companyAdminEmail').value,
    password: document.getElementById('companyAdminPassword').value
  };
  
  try {
    const response = await fetch(`${API_BASE}/company/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    });
    
    const errorEl = document.getElementById('companyLoginError');
    if (response.ok) {
      const data = await response.json();
      token = data.access_token;
      role = data.role;
      companyId = data.company_id;
      
      localStorage.setItem('cc_token', token);
      localStorage.setItem('cc_role', role);
      localStorage.setItem('cc_company_id', companyId);
      
      loginPanel.classList.add('hidden');
      companyDashboard.classList.remove('hidden');
      loadCompanyDashboard();
    } else {
      const error = await response.json();
      errorEl.textContent = error.detail || 'Login failed';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    const errorEl = document.getElementById('companyLoginError');
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

// Load Company Dashboard
async function loadCompanyDashboard() {
  try {
    // Fetch company profile
    const response = await fetch(`${API_BASE}/company/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('companyTitle').textContent = `${profile.name} Dashboard`;
      document.getElementById('companyEmail').textContent = profile.admin_email;
      
      // Load documents and agents
      loadCompanyDocuments();
      loadCompanyAgents();
      loadEmailSettings();
    }
  } catch (err) {
    console.error('Failed to load company dashboard:', err);
  }
}

// Load Company Documents
async function loadCompanyDocuments() {
  try {
    const response = await fetch(`${API_BASE}/documents/list`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const docs = await response.json();
      const listEl = document.getElementById('documentsList');
      
      if (docs.length === 0) {
        listEl.innerHTML = '<p>No documents uploaded yet</p>';
        return;
      }
      
      listEl.innerHTML = docs.map(doc => `
        <div class="document-item">
          <span>${doc.file_name}</span>
          <small>${new Date(doc.created_at).toLocaleDateString()}</small>
          <button class="delete-btn" onclick="deleteDocument(${doc.id})">Delete</button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

// Upload Document
document.getElementById('fileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    const statusEl = document.getElementById('uploadStatus');
    if (response.ok) {
      statusEl.textContent = '✅ Document uploaded successfully!';
      statusEl.style.color = 'green';
      document.getElementById('fileInput').value = '';
      loadCompanyDocuments();
    } else {
      const error = await response.json();
      statusEl.textContent = '❌ ' + (error.detail || 'Upload failed');
      statusEl.style.color = 'red';
    }
  } catch (err) {
    const statusEl = document.getElementById('uploadStatus');
    statusEl.textContent = '❌ ' + err.message;
    statusEl.style.color = 'red';
  }
});

// Delete Document
async function deleteDocument(docId) {
  if (!confirm('Delete this document?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/documents/${docId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadCompanyDocuments();
    }
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// Load Company Agents
async function loadCompanyAgents() {
  try {
    const response = await fetch(`${API_BASE}/company/agents`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const agents = await response.json();
      const listEl = document.getElementById('agentsList');
      
      if (agents.length === 0) {
        listEl.innerHTML = '<p>No agents registered yet</p>';
        return;
      }
      
      listEl.innerHTML = agents.map(agent => `
        <div class="agent-item">
          <div>
            <strong>${agent.username}</strong>
            <small>${agent.email}</small>
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

// Load Email Settings
async function loadEmailSettings() {
  try {
    const response = await fetch(`${API_BASE}/company/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('settingsCareEmail').value = profile.customer_care_email;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Update Email Settings
document.getElementById('updateSettingsBtn')?.addEventListener('click', async () => {
  const updates = {
    customer_care_email: document.getElementById('settingsCareEmail').value,
    smtp_host: document.getElementById('settingsSmtpHost').value,
    smtp_port: parseInt(document.getElementById('settingsSmtpPort').value)
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
      statusEl.style.color = 'green';
    } else {
      const error = await response.json();
      statusEl.textContent = '❌ ' + (error.detail || 'Update failed');
      statusEl.style.color = 'red';
    }
  } catch (err) {
    const statusEl = document.getElementById('settingsStatus');
    statusEl.textContent = '❌ ' + err.message;
    statusEl.style.color = 'red';
  }
});

// Logout Admin
document.getElementById('logoutAdminBtn')?.addEventListener('click', () => {
  if (!confirm('Logout?')) return;
  
  localStorage.removeItem('cc_token');
  localStorage.removeItem('cc_role');
  localStorage.removeItem('cc_company_id');
  token = null;
  role = null;
  companyId = null;
  
  loginPanel.classList.remove('hidden');
  companyDashboard.classList.add('hidden');
});

// ==================== SUPPORT AGENT FUNCTIONS ====================

// Agent Login
document.getElementById('agentLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const loginData = {
    username: document.getElementById('agentUsername').value,
    password: document.getElementById('agentPassword').value
  };
  
  try {
    const response = await fetch(`${API_BASE}/auth/login/human`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    });
    
    const errorEl = document.getElementById('agentLoginError');
    if (response.ok) {
      const data = await response.json();
      token = data.access_token;
      role = data.role;
      companyId = data.company_id;
      
      localStorage.setItem('cc_token', token);
      localStorage.setItem('cc_role', role);
      localStorage.setItem('cc_company_id', companyId);
      
      loginPanel.classList.add('hidden');
      agentDashboard.classList.remove('hidden');
      loadAgentDashboard();
    } else {
      const error = await response.json();
      errorEl.textContent = error.detail || 'Login failed';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    const errorEl = document.getElementById('agentLoginError');
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

// Load Agent Dashboard
async function loadAgentDashboard() {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const user = await response.json();
      document.getElementById('agentInfo').textContent = `Logged in as: ${user.username}`;
      loadTickets();
    }
  } catch (err) {
    console.error('Failed to load agent dashboard:', err);
  }
}

// Load Tickets
async function loadTickets() {
  try {
    const response = await fetch(`${API_BASE}/tickets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const tickets = await response.json();
      const tickelsPanel = document.getElementById('ticketsPanel');
      const statusEl = document.getElementById('ticketStatusText');
      
      if (tickets.length === 0) {
        statusEl.textContent = '✅ All tickets resolved! No unresolved queries.';
        tickelsPanel.innerHTML = '';
        return;
      }
      
      statusEl.textContent = `${tickets.length} unresolved ticket(s)`;
      tickelsPanel.innerHTML = tickets.map(ticket => `
        <div class="ticket-card">
          <div class="ticket-header">
            <h3>${ticket.subject}</h3>
            <span class="ticket-status ${ticket.status}">${ticket.status}</span>
          </div>
          <p><strong>From:</strong> ${ticket.sender_email}</p>
          <p><strong>Message:</strong></p>
          <p>${ticket.body}</p>
          <p><strong>Reason:</strong> ${ticket.reason}</p>
          ${ticket.resolution_note ? `<p><strong>Resolution:</strong> ${ticket.resolution_note}</p>` : ''}
          
          <div class="ticket-actions">
            <input type="text" class="resolution-input" id="resolution_${ticket.id}" placeholder="Resolution note...">
            <button onclick="markTicketResolved(${ticket.id})">Mark as Resolved</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

// Mark Ticket as Resolved
async function markTicketResolved(ticketId) {
  const resolutionNote = document.getElementById(`resolution_${ticketId}`).value;
  
  if (!resolutionNote.trim()) {
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
      alert('✅ Ticket marked as resolved!');
      loadTickets();
    } else {
      alert('Failed to update ticket');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Refresh Tickets
document.getElementById('refreshTicketsBtn')?.addEventListener('click', loadTickets);

// Logout Agent
document.getElementById('logoutAgentBtn')?.addEventListener('click', () => {
  if (!confirm('Logout?')) return;
  
  localStorage.removeItem('cc_token');
  localStorage.removeItem('cc_role');
  localStorage.removeItem('cc_company_id');
  token = null;
  role = null;
  companyId = null;
  
  loginPanel.classList.remove('hidden');
  agentDashboard.classList.add('hidden');
});

// ==================== INITIALIZATION ====================

// Check if user is already logged in
if (token && role) {
  loginPanel.classList.add('hidden');
  
  if (role === 'company_admin') {
    companyDashboard.classList.remove('hidden');
    loadCompanyDashboard();
  } else if (role === 'human_agent') {
    agentDashboard.classList.remove('hidden');
    loadAgentDashboard();
  }
}
