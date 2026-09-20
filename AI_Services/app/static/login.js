// ==================== TAB SWITCHING ====================
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const tabName = event.currentTarget.getAttribute('data-tab');
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach((tab) => {
    tab.classList.remove('active');
    tab.hidden = true;
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });

  const selectedTab = document.getElementById(tabName);
  const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);

  if (selectedTab) {
    selectedTab.hidden = false;
    selectedTab.classList.add('active');
  }

  if (selectedBtn) {
    selectedBtn.classList.add('active');
    selectedBtn.setAttribute('aria-selected', 'true');
  }
}

function showFormError(errorId, message) {
  const errorEl = document.getElementById(errorId);
  if (!errorEl) return;

  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearFormError(errorId) {
  const errorEl = document.getElementById(errorId);
  if (!errorEl) return;

  errorEl.textContent = '';
  errorEl.hidden = true;
}

// ==================== COMPANY REGISTRATION ====================
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
    const response = await fetch('/api/company/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(companyData)
    });

    if (response.ok) {
      alert('Company registered successfully. Please log in with your credentials.');
      document.getElementById('companyRegisterForm').reset();
      clearFormError('companyRegisterError');
      switchTab('company-login');
    } else {
      const error = await response.json();
      showFormError('companyRegisterError', error.detail || 'Registration failed');
    }
  } catch (err) {
    showFormError('companyRegisterError', err.message);
  }
});

// ==================== COMPANY ADMIN LOGIN ====================
document.getElementById('companyLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const loginData = {
    email: document.getElementById('companyAdminEmail').value,
    password: document.getElementById('companyAdminPassword').value
  };

  try {
    const response = await fetch('/api/company/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('cc_token', data.access_token);
      localStorage.setItem('cc_role', data.role);
      localStorage.setItem('cc_company_id', data.company_id);

      window.location.href = '/static/admin-dashboard.html';
    } else {
      const error = await response.json();
      showFormError('companyLoginError', error.detail || 'Login failed');
    }
  } catch (err) {
    showFormError('companyLoginError', err.message);
  }
});

// ==================== AGENT LOGIN ====================
document.getElementById('agentLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const companyEmail = document.getElementById('agentCompanyEmail').value.trim();

  const loginData = {
    username: document.getElementById('agentUsername').value,
    password: document.getElementById('agentPassword').value,
    company_email: companyEmail || null
  };

  try {
    const response = await fetch('/api/auth/login/human', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('cc_token', data.access_token);
      localStorage.setItem('cc_role', data.role);
      localStorage.setItem('cc_company_id', data.company_id);

      window.location.href = '/static/agent-dashboard.html';
    } else {
      const error = await response.json();
      showFormError('agentLoginError', error.detail || 'Login failed');
    }
  } catch (err) {
    showFormError('agentLoginError', err.message);
  }
});

// ==================== AGENT SELF REGISTRATION ====================
document.getElementById('agentRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const registerData = {
    company_email: document.getElementById('agentRegisterCompanyEmail').value,
    username: document.getElementById('agentRegisterUsername').value,
    password: document.getElementById('agentRegisterPassword').value
  };

  try {
    const response = await fetch('/api/auth/register/human-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerData)
    });

    if (response.ok) {
      clearFormError('agentRegisterError');
      alert('Agent registered. You can now log in.');

      document.getElementById('agentUsername').value = registerData.username;
      document.getElementById('agentPassword').value = registerData.password;
      document.getElementById('agentCompanyEmail').value = registerData.company_email;
      document.getElementById('agentRegisterForm').reset();
      switchTab('agent-login');
    } else {
      const error = await response.json();
      showFormError('agentRegisterError', error.detail || 'Agent registration failed');
    }
  } catch (err) {
    showFormError('agentRegisterError', err.message);
  }
});

// Ensure the default tab state matches the markup on first load.
switchTab('company-login');
