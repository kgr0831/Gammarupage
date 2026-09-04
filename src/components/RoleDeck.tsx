"use client";

import { useState } from "react";
import { roles } from "@/data/site";

export function RoleDeck() {
  const [activeId, setActiveId] = useState(roles[0].id);
  const activeIndex = roles.findIndex((role) => role.id === activeId);
  const active = roles[activeIndex];

  const move = (direction: number) => {
    const nextIndex = (activeIndex + direction + roles.length) % roles.length;
    setActiveId(roles[nextIndex].id);
    document.getElementById(`role-${roles[nextIndex].id}`)?.focus();
  };

  return (
    <div className="role-deck">
      <div className="role-tabs" role="tablist" aria-label="게임 제작 역할">
        {roles.map((role) => (
          <button
            key={role.id}
            id={`role-${role.id}`}
            type="button"
            role="tab"
            aria-selected={role.id === activeId}
            aria-controls="role-panel"
            tabIndex={role.id === activeId ? 0 : -1}
            onClick={() => setActiveId(role.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(1);
              if (event.key === "ArrowLeft") move(-1);
            }}
          >
            <span>{role.en}</span>
            <small>{role.ko}</small>
          </button>
        ))}
      </div>
      <div id="role-panel" className="role-panel" role="tabpanel" aria-labelledby={`role-${active.id}`} key={active.id}>
        <span className="role-panel__number">0{activeIndex + 1}</span>
        <div>
          <p className="eyebrow">{active.en} / {active.ko}</p>
          <h3>{active.headline}</h3>
          <p>{active.description}</p>
        </div>
      </div>
    </div>
  );
}
