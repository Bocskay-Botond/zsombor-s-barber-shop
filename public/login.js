if (localStorage.getItem('bb_token')) window.location.href = '/admin';

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errBox = document.getElementById('error-box');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Bejelentkezés...';

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });
    const data = await r.json();
    if (!r.ok) {
      errBox.textContent = data.error || 'Hiba történt';
      errBox.style.display = 'block';
      return;
    }
    localStorage.setItem('bb_token', data.token);
    localStorage.setItem('bb_user', data.username);
    window.location.href = '/admin';
  } catch {
    errBox.textContent = 'Hálózati hiba. Próbáld újra.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bejelentkezés';
  }
});
