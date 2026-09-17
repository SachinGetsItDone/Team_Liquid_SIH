/* Realistic (shaded, proportional) human body figure with tappable regions.
   Front and back views are drawn with layered gradients so the figure reads as
   a body rather than a stick outline: skin tone, muscle shading, hair, hands
   and feet. Transparent hotspot shapes sit over the figure and map to the
   bodymap regions in kiosk/config/interview.json. */

function mkBodySvg(view, selectedId) {
  const sel = (id) => (selectedId === id ? " sel" : "");
  const g = [];

  g.push(`
  <defs>
    <linearGradient id="skin" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#f3d3b6"/>
      <stop offset="0.45" stop-color="#e8b98f"/>
      <stop offset="1" stop-color="#cf9a6d"/>
    </linearGradient>
    <linearGradient id="skin2" x1="1" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#e7b98f"/>
      <stop offset="1" stop-color="#c68e61"/>
    </linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2b30"/>
      <stop offset="1" stop-color="#141418"/>
    </linearGradient>
    <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4d5a66"/>
      <stop offset="1" stop-color="#333d47"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-10%" width="140%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#0f1e2a" flood-opacity="0.16"/>
    </filter>
  </defs>`);

  /* shared limbs, drawn identically for both views */
  const limbs = `
    <rect x="66" y="146" width="36" height="132" rx="18" fill="url(#skin2)"/>
    <rect x="198" y="146" width="36" height="132" rx="18" fill="url(#skin2)"/>
    <rect x="70" y="266" width="30" height="122" rx="15" fill="url(#skin2)"/>
    <rect x="200" y="266" width="30" height="122" rx="15" fill="url(#skin2)"/>
    <ellipse cx="85" cy="402" rx="17" ry="27" fill="url(#skin)"/>
    <ellipse cx="215" cy="402" rx="17" ry="27" fill="url(#skin)"/>
    <ellipse cx="122" cy="530" rx="26" ry="24" fill="url(#skin)"/>
    <ellipse cx="178" cy="530" rx="26" ry="24" fill="url(#skin)"/>
    <rect x="102" y="374" width="46" height="152" rx="23" fill="url(#skin)"/>
    <rect x="152" y="374" width="46" height="152" rx="23" fill="url(#skin)"/>
    <rect x="106" y="544" width="36" height="118" rx="18" fill="url(#skin)"/>
    <rect x="158" y="544" width="36" height="118" rx="18" fill="url(#skin)"/>
    <path d="M104 660 q-6 22 14 24 h20 q10 0 8-16 l-4-14 z" fill="url(#skin2)"/>
    <path d="M196 660 q6 22 -14 24 h-20 q-10 0 -8-16 l4-14 z" fill="url(#skin2)"/>`;

  if (view === "front") {
    g.push(`<g filter="url(#soft)">
      ${limbs}
      <rect x="133" y="96" width="34" height="30" rx="13" fill="url(#skin)"/>
      <path d="M84 134 C84 118 112 110 150 110 C188 110 216 118 216 134
               L212 250 C211 300 205 336 196 366 L104 366 C95 336 89 300 88 250 Z"
            fill="url(#skin)"/>
      <path d="M88 250 C94 262 100 268 108 272 L192 272 C200 268 206 262 212 250 Z"
            fill="#c68e61" opacity="0.35"/>
      <ellipse cx="114" cy="66" rx="8" ry="12" fill="url(#skin2)"/>
      <ellipse cx="186" cy="66" rx="8" ry="12" fill="url(#skin2)"/>
      <ellipse cx="150" cy="60" rx="38" ry="46" fill="url(#skin)"/>
      <path d="M112 40 C118 16 182 16 188 40 C176 28 124 28 112 40 Z" fill="url(#hair)"/>
      <path d="M150 22 q-40 0 -40 40 q0 14 6 24 q-14 -30 14 -42 q22 -10 40 -8 q22 4 26 26 q6 -10 4 -22 q-4 -18 -50 -18 Z" fill="url(#hair)"/>
      <path d="M132 58 q8 -5 16 0" stroke="#8a5a3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M152 58 q8 -5 16 0" stroke="#8a5a3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M150 62 q-4 12 2 16 q4 2 8 0" stroke="#a86f45" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M138 88 q12 8 24 0" stroke="#9c5f4a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M150 112 L150 300" stroke="#b07a4e" stroke-width="1.6" opacity="0.55"/>
      <path d="M150 300 q-16 26 0 66 q16 -40 0 -66 Z" fill="#a86f45" opacity="0.4"/>
    </g>

    <g fill="none" stroke="#a86f45" stroke-width="2" opacity="0.35">
      <path d="M118 140 q30 14 62 0"/>
      <path d="M126 200 q24 10 48 0"/>
    </g>`);
  } else {
    g.push(`<g filter="url(#soft)">
      ${limbs}
      <rect x="133" y="96" width="34" height="30" rx="13" fill="url(#skin2)"/>
      <path d="M84 134 C84 118 112 110 150 110 C188 110 216 118 216 134
               L212 250 C211 300 205 336 196 366 L104 366 C95 336 89 300 88 250 Z"
            fill="url(#skin2)"/>
      <path d="M150 118 L150 320" stroke="#a86f45" stroke-width="2.4" opacity="0.5"/>
      <path d="M104 150 q26 12 46 6 M196 150 q-26 12 -46 6" stroke="#a86f45" stroke-width="2" fill="none" opacity="0.4"/>
      <ellipse cx="150" cy="62" rx="39" ry="47" fill="url(#skin2)"/>
      <path d="M111 44 C114 14 186 14 189 44 q0 22 -4 34 q-6 -30 -35 -30 q-29 0 -35 30 q-4 -12 -4 -34 Z" fill="url(#hair)"/>
      <path d="M150 16 q-42 0 -40 44 q2 20 8 30 q-8 -34 16 -46 q24 -12 44 -4 q20 8 16 40 q6 -12 6 -30 q0 -34 -50 -34 Z" fill="url(#hair)"/>
      <path d="M120 320 q30 22 60 0" stroke="#a86f45" stroke-width="2.2" fill="none" opacity="0.45"/>
    </g>`);
  }

  /* hotspots — transparent overlays that make regions tappable */
  const front = {
    head: `<circle cx="150" cy="60" r="52"/>`,
    chest: `<rect x="96" y="122" width="108" height="112" rx="26"/>`,
    abdomen: `<rect x="100" y="232" width="100" height="126" rx="24"/>`,
    armL: `<rect x="56" y="140" width="50" height="290" rx="24"/>`,
    armR: `<rect x="194" y="140" width="50" height="290" rx="24"/>`,
    legL: `<rect x="92" y="368" width="56" height="300" rx="26"/>`,
    legR: `<rect x="152" y="368" width="56" height="300" rx="26"/>`,
  };
  const back = {
    head: `<circle cx="150" cy="60" r="52"/>`,
    back: `<rect x="96" y="122" width="108" height="240" rx="28"/>`,
    armL: `<rect x="56" y="140" width="50" height="290" rx="24"/>`,
    armR: `<rect x="194" y="140" width="50" height="290" rx="24"/>`,
    legL: `<rect x="92" y="368" width="56" height="300" rx="26"/>`,
    legR: `<rect x="152" y="368" width="56" height="300" rx="26"/>`,
  };
  const spots = view === "front" ? front : back;
  const labels = {
    head: "Head", chest: "Chest", abdomen: "Belly", back: "Back",
    armL: "Left arm", armR: "Right arm", legL: "Left leg", legR: "Right leg",
  };
  const labelPos = {
    head: [150, 12], chest: [150, 172], abdomen: [150, 300], back: [150, 210],
    armL: [30, 300], armR: [270, 300], legL: [78, 520], legR: [222, 520],
  };
  for (const [id, shape] of Object.entries(spots)) {
    const [lx, ly] = labelPos[id];
    g.push(`<g class="bm-hot${sel(id)}" data-region="${id}" tabindex="0" role="button" aria-label="${labels[id]}">
      <g class="hit">${shape}</g>
      <text class="lbl" x="${lx}" y="${ly}" text-anchor="middle">${labels[id]}</text>
    </g>`);
  }
  g.push(`<g class="bm-hot${sel("general")}" data-region="general" tabindex="0" role="button" aria-label="Somewhere else">
    <g class="hit"><circle cx="304" cy="470" r="30"/></g>
    <text class="lbl" x="304" y="430" text-anchor="middle">Elsewhere</text>
  </g>`);

  return `<svg viewBox="0 0 340 720" role="img" aria-label="Human body picture — tap where it hurts">${g.join("\n")}</svg>`;
}
