/**
 * NexusGate Login Platform Engine
 * Manages Auth flows, Validations, State Transitions, LocalDB, 2FA, Toasts and Dashboard
 */

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // State variables
  // ==========================================================================
  let currentUser = null;
  let generated2FACode = null;
  let sessionTimerInterval = null;
  let sessionSecondsElapsed = 0;
  let apiOperationsCount = 0;
  let loginCounts = JSON.parse(localStorage.getItem("nexus_login_counts") || "{}");

  // Mock Database in LocalStorage
  const getLocalUsers = () => JSON.parse(localStorage.getItem("nexus_users") || "[]");
  const saveLocalUsers = (users) => localStorage.setItem("nexus_users", JSON.stringify(users));

  // Initialize with some default users if database is empty
  if (getLocalUsers().length === 0) {
    saveLocalUsers([
      {
        name: "Nexus Admin",
        email: "admin@nexus.io",
        password: "Password123!", // strong password
        joined: new Date().toISOString()
      }
    ]);
  }

  // ==========================================================================
  // DOM Elements Selection
  // ==========================================================================
  
  // Cards / Views
  const cards = {
    login: document.getElementById("loginCard"),
    signup: document.getElementById("signupCard"),
    forgot: document.getElementById("forgotCard"),
    twoFA: document.getElementById("twoFACard"),
    dashboard: document.getElementById("dashboardCard")
  };

  // Forms
  const forms = {
    login: document.getElementById("loginForm"),
    signup: document.getElementById("signupForm"),
    forgot: document.getElementById("forgotForm"),
    twoFA: document.getElementById("twoFAForm")
  };

  // Navigations Buttons/Links
  const nav = {
    toSignup: document.getElementById("toSignupBtn"),
    toForgot: document.getElementById("toForgotBtn"),
    toLoginFromSignup: document.getElementById("toLoginFromSignupBtn"),
    toLoginFromForgot: document.getElementById("toLoginFromForgotBtn"),
    toLoginFrom2FA: document.getElementById("toLoginFrom2FABtn"),
    logout: document.getElementById("logoutBtn")
  };

  // Theme Controls
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  
  // Signup validations & strength meter elements
  const signupFields = {
    name: document.getElementById("signupName"),
    email: document.getElementById("signupEmail"),
    password: document.getElementById("signupPassword"),
    confirmPassword: document.getElementById("signupConfirmPassword"),
    agree: document.getElementById("termsAgree")
  };
  const signupErrors = {
    name: document.getElementById("signupNameError"),
    email: document.getElementById("signupEmailError"),
    password: document.getElementById("signupPasswordError"),
    confirmPassword: document.getElementById("signupConfirmPasswordError"),
    terms: document.getElementById("termsError")
  };
  const strengthBar = document.getElementById("strengthBar");
  const strengthLabel = document.getElementById("strengthLabel");
  const rules = {
    length: document.getElementById("ruleLength"),
    capital: document.getElementById("ruleCapital"),
    number: document.getElementById("ruleNumber"),
    special: document.getElementById("ruleSpecial")
  };

  // Login inputs
  const loginFields = {
    email: document.getElementById("loginEmail"),
    password: document.getElementById("loginPassword"),
    remember: document.getElementById("rememberMe")
  };
  const loginErrors = {
    email: document.getElementById("loginEmailError"),
    password: document.getElementById("loginPasswordError")
  };

  // Forgot password elements
  const forgotFields = {
    email: document.getElementById("forgotEmail")
  };
  const forgotErrors = {
    email: document.getElementById("forgotEmailError")
  };

  // OTP Verification Elements
  const otpInputs = Array.from(document.querySelectorAll(".otp-input"));
  const otpError = document.getElementById("otpError");
  const verificationCodeDisplay = document.getElementById("verificationCodeDisplay");
  const resendCodeBtn = document.getElementById("resendCodeBtn");

  // Dashboard elements
  const db = {
    avatar: document.getElementById("userAvatar"),
    name: document.getElementById("userNameDisplay"),
    email: document.getElementById("userEmailDisplay"),
    loginCount: document.getElementById("loginCountDisplay"),
    timer: document.getElementById("sessionTimerDisplay"),
    apiCount: document.getElementById("apiRequestsDisplay"),
    apiSuccessBtn: document.getElementById("triggerApiSuccessBtn"),
    apiErrorBtn: document.getElementById("triggerApiErrorBtn"),
    activityLog: document.getElementById("activityLogBody")
  };

  // Toast Container
  const toastContainer = document.getElementById("toastContainer");

  // ==========================================================================
  // Helper: Toast Notifications Engine
  // ==========================================================================
  
  function showToast(title, message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    // Choose icons based on toast type
    let iconName = "info";
    if (type === "success") iconName = "check-circle";
    if (type === "error") iconName = "alert-circle";
    if (type === "warning") iconName = "alert-triangle";

    toast.innerHTML = `
      <div class="toast-icon"><i data-lucide="${iconName}"></i></div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" aria-label="Close Toast">
        <i data-lucide="x"></i>
      </button>
    `;

    toastContainer.appendChild(toast);
    lucide.createIcons(); // Initialize SVG icons

    // Trigger transition
    setTimeout(() => {
      toast.classList.add("show");
    }, 10);

    // Auto dismiss after 4 seconds
    const autoDismiss = setTimeout(() => {
      dismissToast(toast);
    }, 4000);

    // Manual close button listener
    const closeBtn = toast.querySelector(".toast-close");
    closeBtn.addEventListener("click", () => {
      clearTimeout(autoDismiss);
      dismissToast(toast);
    });
  }

  function dismissToast(toast) {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => {
      toast.remove();
    });
  }

  // ==========================================================================
  // Helper: View Switcher
  // ==========================================================================
  
  function switchCard(targetCardKey) {
    // Hide all cards
    Object.values(cards).forEach(card => {
      card.classList.remove("active");
    });
    
    // Show target card
    const targetCard = cards[targetCardKey];
    if (targetCard) {
      targetCard.classList.add("active");
    }
  }

  // Trigger error shake on form
  function triggerFormShake(cardElement) {
    cardElement.classList.remove("shake");
    // Trigger reflow to restart animation
    void cardElement.offsetWidth;
    cardElement.classList.add("shake");
  }

  // Clear errors in a card
  function clearErrorsInCard(cardElement) {
    const errorGroups = cardElement.querySelectorAll(".input-group");
    errorGroups.forEach(group => {
      group.classList.remove("has-error");
      const errSpan = group.querySelector(".error-message");
      if (errSpan) errSpan.textContent = "";
    });
    const standaloneErrors = cardElement.querySelectorAll(".error-message");
    standaloneErrors.forEach(err => {
      err.textContent = "";
      if (err.classList.contains("checkbox-error")) {
        err.style.display = "none";
      }
    });
  }

  // ==========================================================================
  // Password Visibility Toggle Logic
  // ==========================================================================
  
  const passwordToggles = document.querySelectorAll(".password-toggle");
  passwordToggles.forEach(toggle => {
    toggle.addEventListener("click", () => {
      const input = toggle.parentElement.querySelector("input");
      const eyeOpen = toggle.querySelector(".eye-open");
      const eyeClosed = toggle.querySelector(".eye-closed");

      if (input.type === "password") {
        input.type = "text";
        eyeOpen.classList.add("hidden");
        eyeClosed.classList.remove("hidden");
      } else {
        input.type = "password";
        eyeOpen.classList.remove("hidden");
        eyeClosed.classList.add("hidden");
      }
    });
  });

  // ==========================================================================
  // Theme Toggle Engine (Dark / Light Switcher)
  // ==========================================================================
  
  const activeTheme = localStorage.getItem("nexus_theme") || "dark";
  document.documentElement.setAttribute("data-theme", activeTheme);

  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("nexus_theme", newTheme);
    showToast(
      "Theme Updated", 
      `NexusGate successfully switched to ${newTheme.toUpperCase()} mode.`, 
      "info"
    );
  });

  // ==========================================================================
  // Input Validation Logic
  // ==========================================================================
  
  const validators = {
    isValidEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    
    showInputError: (inputEl, errorEl, msg) => {
      const parent = inputEl.parentElement;
      parent.classList.add("has-error");
      errorEl.textContent = msg;
    },
    
    clearInputError: (inputEl, errorEl) => {
      const parent = inputEl.parentElement;
      parent.classList.remove("has-error");
      errorEl.textContent = "";
    }
  };

  // Real-time validations triggers
  // Email fields focusout validations
  [loginFields.email, signupFields.email, forgotFields.email].forEach(emailField => {
    emailField.addEventListener("blur", (e) => {
      const val = e.target.value.trim();
      let errorSpan;
      if (e.target === loginFields.email) errorSpan = loginErrors.email;
      if (e.target === signupFields.email) errorSpan = signupErrors.email;
      if (e.target === forgotFields.email) errorSpan = forgotErrors.email;

      if (!val) {
        validators.showInputError(e.target, errorSpan, "Email address is required");
      } else if (!validators.isValidEmail(val)) {
        validators.showInputError(e.target, errorSpan, "Please enter a valid email format");
      } else {
        validators.clearInputError(e.target, errorSpan);
      }
    });
  });

  // Full name validation
  signupFields.name.addEventListener("blur", (e) => {
    const val = e.target.value.trim();
    if (!val) {
      validators.showInputError(e.target, signupErrors.name, "Full name is required");
    } else if (val.length < 2) {
      validators.showInputError(e.target, signupErrors.name, "Full name must be at least 2 characters");
    } else {
      validators.clearInputError(e.target, signupErrors.name);
    }
  });

  // Confirm password validation
  signupFields.confirmPassword.addEventListener("input", (e) => {
    const val = e.target.value;
    const pwdVal = signupFields.password.value;
    if (val !== pwdVal) {
      validators.showInputError(e.target, signupErrors.confirmPassword, "Passwords do not match");
    } else {
      validators.clearInputError(e.target, signupErrors.confirmPassword);
    }
  });

  // ==========================================================================
  // Password Strength Meter Logic
  // ==========================================================================
  
  signupFields.password.addEventListener("input", (e) => {
    const pwd = e.target.value;
    
    // Check validation rules
    const checks = {
      length: pwd.length >= 8,
      capital: /[A-Z]/.test(pwd),
      number: /[0-9]/.test(pwd),
      special: /[^A-Za-z0-9]/.test(pwd)
    };

    // Update rules checklist visual states
    updateRuleVisual(rules.length, checks.length);
    updateRuleVisual(rules.capital, checks.capital);
    updateRuleVisual(rules.number, checks.number);
    updateRuleVisual(rules.special, checks.special);

    // Calculate score
    let score = 0;
    if (pwd.length > 0) {
      if (checks.length) score += 1;
      if (checks.capital) score += 1;
      if (checks.number) score += 1;
      if (checks.special) score += 1;
      // Extra point for length >= 12
      if (pwd.length >= 12 && score === 4) score += 1; 
    }

    // Update Strength Bar visual styles
    strengthBar.className = "strength-bar"; // Reset classes
    if (pwd.length === 0) {
      strengthLabel.textContent = "Password Strength: None";
    } else if (score <= 1) {
      strengthBar.classList.add("strength-weak");
      strengthLabel.textContent = "Password Strength: Weak (High Risk)";
      strengthLabel.style.color = "var(--color-error)";
    } else if (score <= 3) {
      strengthBar.classList.add("strength-fair");
      strengthLabel.textContent = "Password Strength: Fair (Medium Risk)";
      strengthLabel.style.color = "hsl(35, 85%, 50%)";
    } else if (score === 4) {
      strengthBar.classList.add("strength-good");
      strengthLabel.textContent = "Password Strength: Good (Secure)";
      strengthLabel.style.color = "hsl(190, 80%, 45%)";
    } else {
      strengthBar.classList.add("strength-strong");
      strengthLabel.textContent = "Password Strength: Excellent (Highly Secure)";
      strengthLabel.style.color = "var(--color-success)";
    }
  });

  function updateRuleVisual(element, isValid) {
    if (isValid) {
      element.className = "valid";
      element.querySelector("i").setAttribute("data-lucide", "check");
    } else {
      element.className = "invalid";
      element.querySelector("i").setAttribute("data-lucide", "x");
    }
    lucide.createIcons();
  }

  // ==========================================================================
  // Form Submission Transitions & Local DB Logics
  // ==========================================================================

  // Signup form submit
  forms.signup.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.signup);

    const nameVal = signupFields.name.value.trim();
    const emailVal = signupFields.email.value.trim();
    const pwdVal = signupFields.password.value;
    const confirmVal = signupFields.confirmPassword.value;
    const agreed = signupFields.agree.checked;

    let hasErrors = false;

    // Validate inputs
    if (!nameVal) {
      validators.showInputError(signupFields.name, signupErrors.name, "Full name is required");
      hasErrors = true;
    }
    if (!emailVal || !validators.isValidEmail(emailVal)) {
      validators.showInputError(signupFields.email, signupErrors.email, "Valid email address is required");
      hasErrors = true;
    }
    if (pwdVal.length < 8) {
      validators.showInputError(signupFields.password, signupErrors.password, "Password must be at least 8 characters");
      hasErrors = true;
    }
    if (pwdVal !== confirmVal) {
      validators.showInputError(signupFields.confirmPassword, signupErrors.confirmPassword, "Passwords do not match");
      hasErrors = true;
    }
    if (!agreed) {
      signupErrors.terms.textContent = "You must agree to the Terms & Privacy Policy";
      signupErrors.terms.style.display = "block";
      hasErrors = true;
    }

    if (hasErrors) {
      triggerFormShake(cards.signup);
      showToast("Registration Error", "Please resolve all highlighting rules first.", "error");
      return;
    }

    // Check if user already exists
    const users = getLocalUsers();
    if (users.find(u => u.email.toLowerCase() === emailVal.toLowerCase())) {
      validators.showInputError(signupFields.email, signupErrors.email, "Email is already registered");
      triggerFormShake(cards.signup);
      showToast("Registration Failed", "This email account is already registered.", "error");
      return;
    }

    // Save user
    const newUser = {
      name: nameVal,
      email: emailVal,
      password: pwdVal,
      joined: new Date().toISOString()
    };
    users.push(newUser);
    saveLocalUsers(users);

    showToast("Registration Successful", "Account created! Redirecting you to login.", "success");
    forms.signup.reset();
    
    // Reset strength indicators
    strengthBar.className = "strength-bar";
    strengthLabel.textContent = "Password Strength: None";
    Object.values(rules).forEach(rule => {
      rule.className = "invalid";
      rule.querySelector("i").setAttribute("data-lucide", "x");
    });
    lucide.createIcons();

    setTimeout(() => {
      switchCard("login");
    }, 1500);
  });

  // Login form submit
  forms.login.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.login);

    const emailVal = loginFields.email.value.trim();
    const pwdVal = loginFields.password.value;
    
    let hasErrors = false;

    if (!emailVal || !validators.isValidEmail(emailVal)) {
      validators.showInputError(loginFields.email, loginErrors.email, "Valid email address is required");
      hasErrors = true;
    }
    if (!pwdVal) {
      validators.showInputError(loginFields.password, loginErrors.password, "Password is required");
      hasErrors = true;
    }

    if (hasErrors) {
      triggerFormShake(cards.login);
      showToast("Authentication Error", "Please verify required parameters.", "error");
      return;
    }

    // Validate email + password match in LocalStorage DB
    const users = getLocalUsers();
    const matchedUser = users.find(u => u.email.toLowerCase() === emailVal.toLowerCase() && u.password === pwdVal);

    if (!matchedUser) {
      triggerFormShake(cards.login);
      validators.showInputError(loginFields.password, loginErrors.password, "Incorrect email or password");
      showToast("Access Denied", "Invalid login credentials provided.", "error");
      return;
    }

    // Trigger 2FA step verification
    currentUser = matchedUser;
    start2FAFlow();
  });

  // Forgot password form submit
  forms.forgot.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.forgot);

    const emailVal = forgotFields.email.value.trim();

    if (!emailVal || !validators.isValidEmail(emailVal)) {
      validators.showInputError(forgotFields.email, forgotErrors.email, "Valid email address is required");
      triggerFormShake(cards.forgot);
      return;
    }

    // Check if email exists
    const users = getLocalUsers();
    const userExists = users.some(u => u.email.toLowerCase() === emailVal.toLowerCase());

    showToast("Reset Link Sent", "If the email is registered, a recovery link will arrive shortly.", "success");
    forms.forgot.reset();

    setTimeout(() => {
      switchCard("login");
    }, 2000);
  });

  // ==========================================================================
  // OTP / 2FA Engine Logic
  // ==========================================================================

  function start2FAFlow() {
    // Generate a secure mock code
    generated2FACode = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodeDisplay.textContent = generated2FACode;
    
    // Clear previous inputs
    otpInputs.forEach(input => input.value = "");
    otpError.textContent = "";
    
    switchCard("twoFA");
    otpInputs[0].focus();
    
    showToast("2FA Requested", "Enter the verification code shown in the secure alert banner.", "info");
  }

  // Handle OTP Inputs focus cycle
  otpInputs.forEach((input, index) => {
    input.addEventListener("input", (e) => {
      const val = e.target.value;
      
      // Allow only numbers
      if (!/^[0-9]$/.test(val)) {
        e.target.value = "";
        return;
      }

      // Move focus forward
      if (val && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }

      // Auto submit when complete
      if (otpInputs.every(inp => inp.value !== "")) {
        verify2FACode();
      }
    });

    input.addEventListener("keydown", (e) => {
      // Go back on Backspace
      if (e.key === "Backspace" && !e.target.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });
  });

  // Handle Resend Code click
  resendCodeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    generated2FACode = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodeDisplay.textContent = generated2FACode;
    showToast("New OTP Sent", "Check the alert container for the fresh verification token.", "success");
    otpInputs[0].focus();
  });

  forms.twoFA.addEventListener("submit", (e) => {
    e.preventDefault();
    verify2FACode();
  });

  function verify2FACode() {
    const enteredCode = otpInputs.map(input => input.value).join("");
    
    if (enteredCode.length < 6) {
      otpError.textContent = "Please fill in all 6 numbers.";
      triggerFormShake(cards.twoFA);
      return;
    }

    if (enteredCode !== generated2FACode) {
      otpError.textContent = "Invalid verification code. Please try again.";
      triggerFormShake(cards.twoFA);
      showToast("Verification Failed", "Incorrect 2-Factor code.", "error");
      
      // Clear OTP inputs and refocus first input
      otpInputs.forEach(input => input.value = "");
      otpInputs[0].focus();
      return;
    }

    // Successfully verified! Redirect to dashboard
    showToast("Auth Verified", "Secure access granted. Preparing dashboard.", "success");
    
    setTimeout(() => {
      initializeDashboard();
    }, 1000);
  }

  // ==========================================================================
  // Post-Login Interactive Dashboard Controller
  // ==========================================================================

  function initializeDashboard() {
    if (!currentUser) return;

    // Toggle View
    switchCard("dashboard");

    // Display user profile details
    db.name.textContent = currentUser.name;
    db.email.textContent = currentUser.email;
    db.avatar.textContent = currentUser.name.charAt(0).toUpperCase();

    // Increment login counter
    const userEmailKey = currentUser.email.toLowerCase();
    loginCounts[userEmailKey] = (loginCounts[userEmailKey] || 0) + 1;
    localStorage.setItem("nexus_login_counts", JSON.stringify(loginCounts));
    db.loginCount.textContent = loginCounts[userEmailKey];

    // Reset Dashboard Stats
    apiOperationsCount = 0;
    db.apiCount.textContent = apiOperationsCount;
    db.activityLog.innerHTML = ""; // Clear logs

    // Log the successful login action
    addActivityLog("Secure Authentication (2FA)", "Success", "success");

    // Start Session duration active timer
    sessionSecondsElapsed = 0;
    db.timer.textContent = "00:00";
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    
    sessionTimerInterval = setInterval(() => {
      sessionSecondsElapsed++;
      const minutes = Math.floor(sessionSecondsElapsed / 60).toString().padStart(2, "0");
      const seconds = (sessionSecondsElapsed % 60).toString().padStart(2, "0");
      db.timer.textContent = `${minutes}:${seconds}`;
    }, 1000);
  }

  function addActivityLog(action, result, statusClass) {
    const row = document.createElement("tr");
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Simulate dynamic remote server IP
    const randomIp = `192.168.12.${Math.floor(100 + Math.random() * 899)}`;

    row.innerHTML = `
      <td>${timeStr}</td>
      <td><strong>${action}</strong></td>
      <td><span class="log-status ${statusClass}">${result}</span></td>
      <td><code>${randomIp}</code></td>
    `;
    
    // Insert at top of logs table
    db.activityLog.insertBefore(row, db.activityLog.firstChild);
  }

  // Dashboard API Simulated actions
  db.apiSuccessBtn.addEventListener("click", () => {
    apiOperationsCount++;
    db.apiCount.textContent = apiOperationsCount;
    
    addActivityLog("GET /api/v1/profile", "200 OK", "success");
    showToast("API Fetch Completed", "Secure profile attributes downloaded successfully.", "success");
  });

  db.apiErrorBtn.addEventListener("click", () => {
    apiOperationsCount++;
    db.apiCount.textContent = apiOperationsCount;

    addActivityLog("POST /api/v1/secure-action", "429 Too Many Requests", "error");
    showToast("API Access Error", "HTTP 429: Rate-limit ceiling crossed.", "error");
  });

  // Logout control
  nav.logout.addEventListener("click", () => {
    clearInterval(sessionTimerInterval);
    
    showToast("Logged Out", "Session destroyed successfully. Return back soon!", "info");
    
    // Reset state
    currentUser = null;
    generated2FACode = null;
    
    // Switch back to Login card
    setTimeout(() => {
      switchCard("login");
      forms.login.reset();
    }, 800);
  });

  // ==========================================================================
  // Router Card Navigation Bindings
  // ==========================================================================
  
  nav.toSignup.addEventListener("click", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.login);
    forms.login.reset();
    switchCard("signup");
  });

  nav.toForgot.addEventListener("click", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.login);
    forms.login.reset();
    switchCard("forgot");
  });

  nav.toLoginFromSignup.addEventListener("click", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.signup);
    forms.signup.reset();
    switchCard("login");
  });

  nav.toLoginFromForgot.addEventListener("click", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.forgot);
    forms.forgot.reset();
    switchCard("login");
  });

  nav.toLoginFrom2FA.addEventListener("click", (e) => {
    e.preventDefault();
    clearErrorsInCard(cards.twoFA);
    forms.twoFA.reset();
    currentUser = null;
    switchCard("login");
    showToast("Verification Cancelled", "2FA validation aborted.", "warning");
  });
});
