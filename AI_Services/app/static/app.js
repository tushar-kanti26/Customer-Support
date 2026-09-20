// Legacy compatibility shim.
// Some browsers can keep older HTML in cache that still references /static/app.js.
// This file safely forwards to the current page scripts and avoids null-DOM runtime errors.
(function () {
  function loadScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) {
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  const token = localStorage.getItem('cc_token');
  const role = localStorage.getItem('cc_role');
  const path = window.location.pathname;

  // If user is authenticated and lands on root/index, route to role dashboard.
  const isRootLike = path === '/' || path.endsWith('/index.html') || path.endsWith('/static/index.html');
  if (isRootLike && token && role) {
    if (role === 'company_admin') {
      window.location.replace('/static/admin-dashboard.html');
      return;
    }
    if (role === 'human_agent') {
      window.location.replace('/static/agent-dashboard.html');
      return;
    }
  }

  // Forward cached pages to their current controllers by checking current DOM.
  const hasLoginSurface = !!document.getElementById('companyLoginForm');
  const hasAdminSurface = !!document.getElementById('form-admin-settings') || !!document.getElementById('admin-doc-list');
  const hasAgentSurface = !!document.getElementById('agent-ticket-list') || !!document.getElementById('ticket-filters');

  if (hasLoginSurface) {
    loadScript('/static/login.js');
    return;
  }

  if (hasAdminSurface) {
    loadScript('/static/admin-dashboard.js');
    return;
  }

  if (hasAgentSurface) {
    loadScript('/static/agent-dashboard.js');
  }
})();
