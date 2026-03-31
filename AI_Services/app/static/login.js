// ==================== TAB SWITCHING ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = e.target.getAttribute('data-tab');
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  const selectedTab = document.getElementById(tabName);
  const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (selectedTab) selectedTab.classList.add('active');
  if (selectedBtn) selectedBtn.classList.add('active');
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
    
    const errorEl = document.getElementById('companyLoginError');
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('cc_token', data.access_token);
      localStorage.setItem('cc_role', data.role);
      localStorage.setItem('cc_company_id', data.company_id);
      
      // Redirect to admin dashboard
      window.location.href = '/static/admin-dashboard.html';
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
    
    const errorEl = document.getElementById('agentLoginError');
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('cc_token', data.access_token);
      localStorage.setItem('cc_role', data.role);
      localStorage.setItem('cc_company_id', data.company_id);
      
      // Redirect to agent dashboard
      window.location.href = '/static/agent-dashboard.html';
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

    const errorEl = document.getElementById('agentRegisterError');
    if (response.ok) {
      errorEl.style.display = 'none';
      alert('✅ Agent registered. You can now login.');

      document.getElementById('agentUsername').value = registerData.username;
      document.getElementById('agentPassword').value = registerData.password;
      document.getElementById('agentCompanyEmail').value = registerData.company_email;
      document.getElementById('agentRegisterForm').reset();
    } else {
      const error = await response.json();
      errorEl.textContent = error.detail || 'Agent registration failed';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    const errorEl = document.getElementById('agentRegisterError');
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});
