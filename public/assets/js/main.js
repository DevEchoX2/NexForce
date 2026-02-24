(() => {
  const openButtons = document.querySelectorAll("[data-open-launch]");
  const modal = document.querySelector("[data-launch-modal]");
  const closeButtons = document.querySelectorAll("[data-close-launch]");
  const gameName = document.querySelector("[data-launch-game]");
  const queueEl = document.querySelector("[data-queue]");
  const latencyEl = document.querySelector("[data-latency]");
  const fpsEl = document.querySelector("[data-fps]");
  const etaEl = document.querySelector("[data-eta]");

  let intervalRef;

  const stopSimulation = () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = undefined;
    }
  };

  const runSimulation = () => {
    let queue = Math.floor(Math.random() * 28) + 12;
    let eta = Math.ceil(queue / 3);

    queueEl.textContent = String(queue);
    etaEl.textContent = `${eta} min`;

    stopSimulation();
    intervalRef = setInterval(() => {
      queue = Math.max(0, queue - (Math.floor(Math.random() * 3) + 1));
      eta = Math.max(0, Math.ceil(queue / 3));
      const latency = Math.floor(Math.random() * 14) + 15;
      const fps = Math.floor(Math.random() * 18) + 103;

      queueEl.textContent = String(queue);
      etaEl.textContent = queue === 0 ? "Launching..." : `${eta} min`;
      latencyEl.textContent = `${latency} ms`;
      fpsEl.textContent = `${fps} FPS`;
    }, 1200);
  };

  const openLaunchModal = (selectedGame) => {
    if (!modal) {
      return;
    }

    if (gameName) {
      gameName.textContent = selectedGame || "Cloud Session";
    }

    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    runSimulation();
  };

  const closeLaunchModal = () => {
    if (!modal) {
      return;
    }

    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    stopSimulation();
  };

  openButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openLaunchModal(button.getAttribute("data-game") || "Cloud Session");
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeLaunchModal);
  });

  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeLaunchModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLaunchModal();
    }
  });

  const billingToggle = document.querySelector("[data-billing-toggle]");
  if (billingToggle) {
    billingToggle.addEventListener("change", () => {
      const yearly = billingToggle.checked;
      document.querySelectorAll("[data-monthly]").forEach((el) => {
        el.classList.toggle("hidden", yearly);
      });
      document.querySelectorAll("[data-yearly]").forEach((el) => {
        el.classList.toggle("hidden", !yearly);
      });
    });
  }
})();