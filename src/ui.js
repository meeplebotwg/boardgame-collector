// Tiny DOM builder plus the shared components from the spec's
// "Screens / Views" section.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null) el.append(c);
  }
  return el;
}

// Fixed header: kicker + title left, Cancel action right (tapping it
// returns toward Home).
export function header(kicker, title, onCancel) {
  return h(
    "header",
    { class: "header" },
    h(
      "div",
      { class: "header-left" },
      kicker ? h("div", { class: "kicker" }, kicker) : null,
      h("h1", { class: "title" }, title),
    ),
    onCancel
      ? h(
          "button",
          { class: "header-action", type: "button", onclick: onCancel },
          "Cancel",
        )
      : null,
  );
}

export function sectionLabel(text) {
  return h("div", { class: "section-label" }, text);
}

// Primary CTA. Disabled state swaps the label to an instruction per spec.
export function cta(getLabel, getEnabled, ontap) {
  const btn = h("button", {
    class: "cta",
    type: "button",
    onclick: () => {
      if (!btn.disabled) ontap();
    },
  });
  const update = () => {
    btn.disabled = !getEnabled();
    btn.textContent = getLabel();
  };
  update();
  return { btn, update };
}

// Single-select chip row.
export function chipRow(options, isSelected, onpick) {
  const buttons = options.map((o) =>
    h(
      "button",
      {
        class: "chip",
        type: "button",
        onclick: () => {
          onpick(o);
          refresh();
        },
      },
      o,
    ),
  );
  function refresh() {
    buttons.forEach((b, i) =>
      b.classList.toggle("chip-on", isSelected(options[i])),
    );
  }
  refresh();
  return h("div", { class: "chip-row" }, buttons);
}
