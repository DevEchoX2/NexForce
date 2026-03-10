import {
  appState,
  initAuthShell,
  signInWithPassword,
  registerAccount,
} from "./app.js";

const hydrateProfile = () => {
  const user = appState.authUser;
  const nameEl = document.querySelector("[data-profile-name]");
  const emailEl = document.querySelector("[data-profile-email]");
  const statusEl = document.querySelector("[data-profile-status]");
  const signInWrap = document.querySelector("[data-profile-signin]");
  const settingsWrap = document.querySelector("[data-profile-settings]");

  if (!user) {
    if (nameEl) nameEl.textContent = "Guest";
    if (emailEl) emailEl.textContent = "Not signed in";
    if (statusEl) statusEl.textContent = "Signed Out";
    signInWrap?.classList.remove("hidden");
    settingsWrap?.classList.add("hidden");
    return;
  }

  if (nameEl) nameEl.textContent = user.name;
  if (emailEl) emailEl.textContent = user.email;
  if (statusEl) statusEl.textContent = "Signed In";
  signInWrap?.classList.add("hidden");
  settingsWrap?.classList.remove("hidden");
};

const initSettingsForm = () => {
  const deviceSelect = document.querySelector("[data-device]");
  const networkSelect = document.querySelector("[data-network]");
  const transportSelect = document.querySelector("[data-transport-mode]");
  const form = document.querySelector("[data-settings-form]");
  const savedText = document.querySelector("[data-saved-text]");

  if (!deviceSelect || !networkSelect || !transportSelect || !form) {
    return;
  }

  deviceSelect.value = appState.preferredDevice || "PC";
  networkSelect.value = appState.networkProfile || "Balanced";
  transportSelect.value = appState.transportMode || "auto";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    appState.preferredDevice = deviceSelect.value;
    appState.networkProfile = networkSelect.value;
    appState.transportMode = transportSelect.value;
    if (savedText) {
      savedText.textContent = "Settings saved.";
    }
  });
};

const initAuthForms = () => {
  const loginTabBtn = document.querySelector("[data-auth-tab-login]");
  const registerTabBtn = document.querySelector("[data-auth-tab-register]");
  const loginForm = document.querySelector("[data-login-form]");
  const registerForm = document.querySelector("[data-register-form]");
  const messageEl = document.querySelector("[data-auth-message]");

  if (!loginForm || !registerForm || !loginTabBtn || !registerTabBtn) {
    return;
  }

  const setAuthMessage = (text, isError = false) => {
    if (!messageEl) {
      return;
    }
    messageEl.textContent = text;
    messageEl.classList.toggle("text-red-300", isError);
    messageEl.classList.toggle("text-soft", !isError);
  };

  const showLogin = () => {
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    loginTabBtn.className = "rounded-lg border border-primary/70 bg-primary px-3 py-1 text-xs font-semibold text-black";
    registerTabBtn.className = "rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white";
  };

  const showRegister = () => {
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    registerTabBtn.className = "rounded-lg border border-primary/70 bg-primary px-3 py-1 text-xs font-semibold text-black";
    loginTabBtn.className = "rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white";
  };

  loginTabBtn.addEventListener("click", showLogin);
  registerTabBtn.addEventListener("click", showRegister);

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = loginForm.querySelector("[data-login-email]")?.value?.trim();
    const password = loginForm.querySelector("[data-login-password]")?.value || "";

    try {
      await signInWithPassword({ email, password });
      setAuthMessage("Logged in successfully.");
      hydrateProfile();
      initAuthShell();
      initSettingsForm();
    } catch (error) {
      setAuthMessage(error?.payload?.error || "Login failed.", true);
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = registerForm.querySelector("[data-register-name]")?.value?.trim();
    const email = registerForm.querySelector("[data-register-email]")?.value?.trim();
    const password = registerForm.querySelector("[data-register-password]")?.value || "";

    try {
      await registerAccount({ name, email, password, tier: "free" });
      setAuthMessage("Account created and signed in.");
      hydrateProfile();
      initAuthShell();
      initSettingsForm();
    } catch (error) {
      setAuthMessage(error?.payload?.error || "Registration failed.", true);
    }
  });
};

const init = async () => {
  initAuthShell();
  hydrateProfile();
  initSettingsForm();
  initAuthForms();
};

init().catch((error) => {
  console.error(error);
});
