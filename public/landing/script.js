/* Full-document landing runtime; loaded once on each navigation to /. */
/* global heroReel, galleryGames */
(() => {
  "use strict";

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const video = document.querySelector(".reel-video");
  const reelBackdrop = document.querySelector(".hero-reel");
  const credits = document.querySelector(".reel-credits");
  const connection = navigator.connection;
  let motionPaused = reducedMotion.matches;
  let reelVisible = !("IntersectionObserver" in window);
  let autoplayBlocked = false;
  let videoFailed = false;
  let playAttempt = 0;
  let currentCue = -1;

  function updateCredits() {
    let nextCue = 0;
    for (let index = heroReel.cues.length - 1; index >= 0; index--) {
      if (video.currentTime >= heroReel.cues[index].at) {
        nextCue = index;
        break;
      }
    }
    if (nextCue === currentCue) return;
    currentCue = nextCue;
    const games = heroReel.cues[nextCue].games;
    const list = credits.querySelector("ul");
    list.replaceChildren();
    credits.dataset.layout = games.length > 1 ? "grid" : "single";
    for (const game of games) {
      const item = element("li");
      item.dataset.gameId = game.uid;
      item.append(element("strong", "", game.title));
      if (game.creators.length) item.append(element("p", "credit-people", game.creators.join(" · ")));
      item.append(element("p", "", [game.team, game.event].filter(Boolean).join(" · ")));
      list.append(item);
    }
  }

  function syncVideo() {
    const attempt = ++playAttempt;
    if (reducedMotion.matches || connection?.saveData) {
      video.pause();
      if (video.hasAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
      delete reelBackdrop.dataset.loaded;
      credits.hidden = true;
      return;
    }
    if (motionPaused || document.hidden || !reelVisible || document.body.matches(".menu-open,.dialog-open") || autoplayBlocked || videoFailed) {
      video.pause();
      return;
    }
    if (!video.hasAttribute("src")) {
      video.muted = true;
      const compact = window.matchMedia("(max-width: 1024px)").matches || ["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
      video.src = compact ? heroReel.sources.mobile : heroReel.sources.desktop;
    }
    void video.play().catch((error) => {
      if (attempt !== playAttempt || error.name === "AbortError") return;
      if (error.name === "NotAllowedError") autoplayBlocked = true;
      else videoFailed = true;
      delete reelBackdrop.dataset.loaded;
      credits.hidden = true;
      syncMotion();
    });
  }

  function syncMotion() {
    motionPaused = reducedMotion.matches || Boolean(connection?.saveData);
    root.classList.toggle("motion-paused", motionPaused || document.hidden);
    syncVideo();
    window.dispatchEvent(new Event("gammaru:motionchange"));
  }
  // Retry blocked autoplay after a real page interaction, without a playback UI.
  function retryAutoplay() {
    if (!autoplayBlocked || reducedMotion.matches || connection?.saveData) return;
    autoplayBlocked = false;
    syncVideo();
  }
  document.addEventListener("pointerdown", retryAutoplay);
  document.addEventListener("keydown", retryAutoplay);
  reducedMotion.addEventListener("change", syncMotion);
  connection?.addEventListener("change", syncMotion);
  video.addEventListener("playing", () => {
    if (motionPaused || document.hidden || !reelVisible || document.body.matches(".menu-open,.dialog-open")) {
      video.pause();
      return;
    }
    reelBackdrop.dataset.loaded = "true";
    credits.hidden = false;
    updateCredits();
  });
  video.addEventListener("error", () => {
    if (!video.hasAttribute("src")) return;
    videoFailed = true;
    delete reelBackdrop.dataset.loaded;
    credits.hidden = true;
    syncMotion();
  });
  video.addEventListener("timeupdate", updateCredits);
  video.addEventListener("seeked", updateCredits);
  syncMotion();

  if ("IntersectionObserver" in window) {
    root.classList.add("js-motion");
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
    const videoObserver = new IntersectionObserver(([entry]) => {
      reelVisible = entry.isIntersecting;
      syncVideo();
    }, { threshold: 0 });
    videoObserver.observe(document.querySelector(".hero"));
  }

  document.addEventListener("visibilitychange", syncMotion);

  function syncOverlay() {
    syncVideo();
    window.dispatchEvent(new Event("gammaru:overlaychange"));
  }

  const menuToggle = document.querySelector(".menu-toggle");
  const drawer = document.querySelector(".navigation-drawer");
  let closingMenu = false;
  async function closeMenu(target = null) {
    if (!drawer.open || closingMenu) return;
    closingMenu = true;
    if (!motionPaused) {
      const animation = drawer.animate([
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(36px)", opacity: 0 },
      ], { duration: 180, easing: "ease-in", fill: "forwards" });
      await animation.finished.catch(() => {});
      animation.cancel();
    }
    drawer.close();
    document.body.classList.remove("menu-open");
    syncOverlay();
    menuToggle.setAttribute("aria-expanded", "false");
    closingMenu = false;
    if (target) {
      history.replaceState(null, "", target);
      const destination = document.querySelector(target);
      destination?.scrollIntoView({ behavior: motionPaused ? "instant" : "smooth", block: "start" });
      destination?.setAttribute("tabindex", "-1");
      destination?.focus({ preventScroll: true });
    } else menuToggle.focus({ preventScroll: true });
  }
  menuToggle.addEventListener("click", () => {
    if (drawer.open) { void closeMenu(); return; }
    drawer.showModal();
    document.body.classList.add("menu-open");
    syncOverlay();
    menuToggle.setAttribute("aria-expanded", "true");
    drawer.querySelector(".drawer-close").focus({ preventScroll: true });
  });
  drawer.querySelector(".drawer-close").addEventListener("click", () => void closeMenu());
  drawer.addEventListener("cancel", (event) => { event.preventDefault(); void closeMenu(); });
  drawer.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link) {
      const href = link.getAttribute("href");
      if (href?.startsWith("#")) { event.preventDefault(); void closeMenu(href); }
      else void closeMenu();
      return;
    }
    if (event.target !== drawer) return;
    const bounds = drawer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) void closeMenu();
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  const dialog = document.querySelector(".game-dialog");
  let dialogTrigger = null;

  function openGame(game, trigger) {
    dialogTrigger = trigger;
    const image = dialog.querySelector(".dialog-image");
    image.src = game.cover;
    image.alt = `${game.title} 게임 화면`;
    document.querySelector("#dialog-event").textContent = `${game.year} / ${game.event}`;
    document.querySelector("#dialog-title").textContent = game.title;
    document.querySelector("#dialog-description").textContent = game.description;
    const credits = dialog.querySelector(".dialog-credits");
    credits.replaceChildren();
    for (const [label, value] of [["제작", game.team], ["참여", game.creators.join(", ")], ["장르", game.genre]]) {
      if (value) credits.append(element("dt", "", label), element("dd", "", value));
    }
    const download = document.querySelector("#dialog-download");
    download.hidden = !game.download;
    if (game.download) download.href = game.download;
    else download.removeAttribute("href");
    document.body.classList.add("dialog-open");
    syncOverlay();
    dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector(".dialog-close").focus({ preventScroll: true });
  }

  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
    syncOverlay();
    dialogTrigger?.focus({ preventScroll: true });
  });

  const gallery = document.querySelector("#game-grid");
  for (const game of galleryGames) {
    const card = element("button", "game-card reveal");
    card.type = "button";
    card.dataset.season = game.season;
    card.setAttribute("aria-label", `${game.title} 작품 상세 보기`);
    card.setAttribute("aria-haspopup", "dialog");
    const cover = element("div", "game-cover");
    const image = element("img");
    image.src = game.cover;
    image.alt = `${game.title} 게임 화면`;
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 640;
    image.height = 400;
    cover.append(image);
    const meta = element("div", "game-meta");
    meta.append(element("h3", "", game.title), element("span", "", `${game.year} ${game.event}`));
    card.append(cover, meta, element("p", "", game.genre));
    card.addEventListener("click", () => openGame(game, card));
    gallery.append(card);
  }
  window.dispatchEvent(new Event("gammaru:galleryready"));

  const filters = [...document.querySelectorAll("[data-filter]")];
  filters.forEach((filter) => filter.addEventListener("click", () => {
    const selected = filter.dataset.filter;
    filters.forEach((button) => button.setAttribute("aria-pressed", String(button === filter)));
    let count = 0;
    gallery.querySelectorAll(".game-card").forEach((card) => {
      card.hidden = selected !== "all" && card.dataset.season !== selected;
      if (!card.hidden) count++;
    });
    document.querySelector(".gallery-count").textContent = `${count}개 작품`;
    window.dispatchEvent(new Event("gammaru:filterchange"));
  }));

  const tabs = [...document.querySelectorAll("[role=tab]")];
  function selectRole(selected, moveFocus = false) {
    tabs.forEach((tab) => {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
    });
    if (moveFocus) selected.focus();
    window.dispatchEvent(new CustomEvent("gammaru:rolechange", { detail: selected.dataset.role }));
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectRole(tab));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (["ArrowDown", "ArrowRight"].includes(event.key)) next = (index + 1) % tabs.length;
      else if (["ArrowUp", "ArrowLeft"].includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectRole(tabs[next], true);
    });
  });

  // Resolve section links after gallery layout, before the first visibility callback.
  const initialAnchor = document.getElementById(location.hash.slice(1));
  if (initialAnchor && !["home", "main"].includes(initialAnchor.id)) {
    initialAnchor.scrollIntoView({ behavior: "instant", block: "start" });
  }
  document.querySelector("#current-year").textContent = String(new Date().getFullYear());
})();
