"use client";

import { useEffect } from "react";

const selector = ".reveal, .game-card, .process-line";

export function MotionLayer() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    if (reduced) return;

    root.classList.add("motion-ready");
    let pointerFrame = 0;
    let scrollFrame = 0;
    let motionFrame = 0;
    const pending = new Set<HTMLElement>();

    const updatePointer = (event: PointerEvent) => {
      if (!precisePointer || pointerFrame) return;
      pointerFrame = window.requestAnimationFrame(() => {
        const normalizedX = event.clientX / window.innerWidth - 0.5;
        const normalizedY = event.clientY / window.innerHeight - 0.5;
        root.style.setProperty("--cursor-x", `${event.clientX}px`);
        root.style.setProperty("--cursor-y", `${event.clientY}px`);
        root.style.setProperty("--parallax-x", `${(normalizedX * 12).toFixed(2)}px`);
        root.style.setProperty("--parallax-y", `${(normalizedY * 8).toFixed(2)}px`);
        pointerFrame = 0;
      });
    };

    const checkMotion = () => {
      motionFrame = 0;
      const boundary = window.innerHeight * 0.98;
      pending.forEach((element) => {
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom <= 0 || bounds.top >= boundary) return;
        element.classList.add("is-visible");
        pending.delete(element);
      });
    };

    const scheduleMotionCheck = () => {
      if (motionFrame) return;
      motionFrame = window.requestAnimationFrame(checkMotion);
    };

    const updateScroll = () => {
      scheduleMotionCheck();
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        const distance = document.documentElement.scrollHeight - window.innerHeight;
        const progress = distance > 0 ? Math.min(window.scrollY / distance, 1) : 0;
        root.style.setProperty("--scroll-progress", progress.toFixed(4));
        scrollFrame = 0;
      });
    };

    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("resize", scheduleMotionCheck, { passive: true });
    updateScroll();

    const cardCleanups = new Map<HTMLElement, () => void>();

    const bindCard = (element: HTMLElement) => {
      if (!precisePointer || cardCleanups.has(element)) return;

      const move = (event: PointerEvent) => {
        const bounds = element.getBoundingClientRect();
        const x = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
        const y = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);
        element.style.setProperty("--card-x", `${(x * 100).toFixed(1)}%`);
        element.style.setProperty("--card-y", `${(y * 100).toFixed(1)}%`);
        element.style.setProperty("--card-tilt-x", `${((0.5 - y) * 3.2).toFixed(2)}deg`);
        element.style.setProperty("--card-tilt-y", `${((x - 0.5) * 4.2).toFixed(2)}deg`);
      };
      const leave = () => {
        element.style.setProperty("--card-tilt-x", "0deg");
        element.style.setProperty("--card-tilt-y", "0deg");
      };

      element.addEventListener("pointermove", move, { passive: true });
      element.addEventListener("pointerleave", leave, { passive: true });
      cardCleanups.set(element, () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerleave", leave);
      });
    };

    const watch = (scope: ParentNode) => {
      scope.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        if (element.matches(".game-card")) bindCard(element);
        if (!element.dataset.motionReady) element.dataset.motionReady = "true";
        if (element.classList.contains("is-visible")) return;
        pending.add(element);
      });
      scheduleMotionCheck();
    };

    watch(document);
    const mutations = new MutationObserver((entries) => {
      for (const entry of entries) {
        entry.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node.matches(selector)) watch(node.parentNode ?? document);
            else watch(node);
          }
        });
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      pending.clear();
      cardCleanups.forEach((cleanup) => cleanup());
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("scroll", updateScroll);
      window.removeEventListener("resize", scheduleMotionCheck);
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      if (motionFrame) window.cancelAnimationFrame(motionFrame);
      root.classList.remove("motion-ready");
    };
  }, []);

  return null;
}
