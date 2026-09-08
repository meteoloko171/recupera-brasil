const consultForm = document.getElementById('consultForm');
const cpfInput = document.getElementById('cpfInput');
const emailInput = document.getElementById('emailInput');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const cpfError = document.getElementById('cpfError');
const emailError = document.getElementById('emailError');

// CPF Mask
cpfInput.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '');
  if (v.length > 11) v = v.substring(0, 11);

  if (v.length > 9) {
    v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  } else if (v.length > 6) {
    v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  } else if (v.length > 3) {
    v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  }
  
  e.target.value = v;

  if (cpfInput.classList.contains('error')) {
    cpfInput.classList.remove('error');
    if (cpfError) cpfError.classList.remove('visible');
  }

  updateButtonState();
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

emailInput.addEventListener('input', () => {
  if (emailInput.classList.contains('error')) {
    emailInput.classList.remove('error');
    if (emailError) emailError.classList.remove('visible');
  }
  updateButtonState();
});

// Update Button State Dynamically
function updateButtonState() {
  const rawCpf = cpfInput.value.replace(/\D/g, '');
  const isCpfValid = rawCpf.length === 11;
  const isEmailValid = isValidEmail(emailInput.value);

  if (isCpfValid && isEmailValid) {
    submitBtn.disabled = false;
    submitBtn.classList.remove('disabled');
    submitBtn.classList.add('active-btn');
    btnText.textContent = 'CONSULTAR OS VALORES';
  } else {
    submitBtn.disabled = true;
    submitBtn.classList.add('disabled');
    submitBtn.classList.remove('active-btn');
    
    if (rawCpf.length === 0) {
      btnText.textContent = 'DIGITE O CPF PARA IDENTIFICAR';
    } else if (rawCpf.length < 11) {
      btnText.textContent = 'DIGITE O CPF COMPLETO (11 DÍGITOS)';
    } else if (!isEmailValid) {
      btnText.textContent = 'DIGITE UM E-MAIL VÁLIDO';
    }
  }
}

// Form Submission
submitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  handleConsultation();
});

function handleConsultation() {
  const rawCpf = cpfInput.value.replace(/\D/g, '');
  const emailVal = emailInput.value.trim();

  if (rawCpf.length !== 11) {
    cpfInput.classList.add('error');
    if (cpfError) cpfError.classList.add('visible');
    cpfInput.focus();
    return;
  }

  if (!emailVal || !isValidEmail(emailVal)) {
    emailInput.classList.add('error');
    if (emailError) emailError.classList.add('visible');
    emailInput.focus();
    return;
  }

  // Save to localStorage
  localStorage.setItem('recupera_cpf', rawCpf);
  localStorage.setItem('recupera_cpf_formatted', cpfInput.value);
  localStorage.setItem('recupera_email', emailVal);

  // Redirect to loading page
  window.location.href = 'loading.html';
}

document.addEventListener('DOMContentLoaded', updateButtonState);
