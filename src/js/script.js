document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  
  // Alternar entre login y registro
  const showRegister = () => {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  };
  
  const showLogin = () => {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  };
  
  // Event listeners
  document.querySelector('#login-link').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
  });
  
  document.querySelector('#register-link').addEventListener('click', (e) => {
    e.preventDefault();
    showRegister();
  });
  
  // Login form submission
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = loginForm.querySelector('input[type="email"]').value;
    const password = loginForm.querySelector('input[type="password"]').value;
    // Aquí iría la lógica de login
    alert(`Iniciando sesión con: ${email}`);
  });
  
  // Register form submission
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = registerForm.querySelector('input[type="text"]').value;
    const email = registerForm.querySelector('input[type="email"]').value;
    const password = registerForm.querySelector('input[type="password"]').value;
    // Aquí iría la lógica de registro
    alert(`Registrando usuario: ${name} - ${email}`);
  });
});