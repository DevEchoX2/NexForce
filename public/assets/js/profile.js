import {
  appState,
  initAuthShell,
  signInDemo,
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
  const form = document.querySelector("[data-settings-form]");
  const savedText = document.querySelector("[data-saved-text]");

  if (!deviceSelect || !networkSelect || !form) {
    return;
  }

  deviceSelect.value = appState.preferredDevice || "PC";
  networkSelect.value = appState.networkProfile || "Balanced";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    appState.preferredDevice = deviceSelect.value;
    appState.networkProfile = networkSelect.value;
    if (savedText) {
      savedText.textContent = "Settings saved.";
    }
  });
};

const init = async () => {
  initAuthShell();
  hydrateProfile();
  initSettingsForm();

  document.querySelector("[data-profile-signin-btn]")?.addEventListener("click", async () => {
    await signInDemo();
    hydrateProfile();
    initAuthShell();
    initSettingsForm();
  });
};

init().catch((error) => {
  console.error(error);
});
