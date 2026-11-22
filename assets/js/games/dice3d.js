"use strict";
// Shared aeroplane/Monopoly die geometry. A result is supplied by each game's referee.
WorkTimeApp.games.dice3d = (() => {
  // Rotate a fixed face onto the top of the die before applying the camera tilt.
  const dieAngles = [
    null,
    [0, 0],
    [90, 0],
    [0, 90],
    [0, -90],
    [-90, 0],
    [180, 0],
  ];
  const diePose = (pitch, bank, spin = 0) =>
    `rotateX(-57deg) rotateY(-18deg) rotateY(${spin}deg) rotateX(${pitch}deg) rotateZ(${bank}deg)`;

  function el(tag, cls, text, parent) {
    const node = document.createElement(tag);
    node.className = cls;
    parent.append(node);
    return node;
  }
  function svg(tag, attrs, parent) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, String(value));
    parent.append(node);
    return node;
  }
  function draw(dice, value) {
    let cube = dice.querySelector(".aero-dice-cube");
    if (!cube) {
      const scene = el("span", "aero-dice-scene", undefined, dice);
      scene.setAttribute("aria-hidden", "true");
      const lift = el("span", "aero-dice-lift", undefined, scene);
      cube = el("span", "aero-dice-cube", undefined, lift);
    }
    cube.style.transform = diePose(...dieAngles[value || 1]);
    if (cube.childElementCount) return;
    const patterns = [
      [],
      [[0.5, 0.5]],
      [
        [0.27, 0.27],
        [0.73, 0.73],
      ],
      [
        [0.27, 0.27],
        [0.5, 0.5],
        [0.73, 0.73],
      ],
      [
        [0.27, 0.27],
        [0.73, 0.27],
        [0.27, 0.73],
        [0.73, 0.73],
      ],
      [
        [0.27, 0.27],
        [0.73, 0.27],
        [0.5, 0.5],
        [0.27, 0.73],
        [0.73, 0.73],
      ],
      [
        [0.27, 0.23],
        [0.73, 0.23],
        [0.27, 0.5],
        [0.73, 0.5],
        [0.27, 0.77],
        [0.73, 0.77],
      ],
    ];
    const faces = {
      top: 1,
      bottom: 6,
      front: 2,
      back: 5,
      right: 4,
      left: 3,
    };
    for (const [name, n] of Object.entries(faces)) {
      const face = el(
        "span",
        "aero-die-face aero-die-" + name,
        undefined,
        cube,
      );
      face.dataset.faceValue = String(n);
      const drawing = svg("svg", { viewBox: "0 0 100 100" }, face);
      for (const [x, y] of patterns[n]) {
        svg(
          "circle",
          {
            cx: x * 100,
            cy: y * 100,
            r: n === 1 ? 15 : 9.4,
            class: "aero-die-pip",
          },
          drawing,
        );
      }
    }
  }

  function frames(startingFace, result) {
    const [pitch, bank] = dieAngles[result];
    const direction = result % 2 ? 1 : -1;
    const settled = diePose(pitch + 720, bank, 360 * direction);
    const atRest = "translate(0, 0)";
    return [
      {
        part: "cube",
        keyframes: [
          { transform: diePose(...dieAngles[startingFace || 1]) },
          {
            transform: diePose(285, 125 * direction, 150 * direction),
            offset: 0.28,
          },
          {
            transform: diePose(
              pitch + 655,
              bank - 26 * direction,
              350 * direction,
            ),
            offset: 0.49,
            easing: "ease-out",
          },
          { transform: settled, offset: 0.62 },
          { transform: settled },
        ],
      },
      {
        part: "lift",
        keyframes: [
          { transform: atRest, easing: "ease-out" },
          {
            transform: `translate(${-direction * 20}%, -44%)`,
            offset: 0.17,
            easing: "ease-in",
          },
          {
            transform: `translate(${direction * 14}%, 5%)`,
            offset: 0.42,
            easing: "ease-out",
          },
          {
            transform: `translate(${direction * 8}%, -17%)`,
            offset: 0.51,
            easing: "ease-in",
          },
          { transform: atRest, offset: 0.62 },
          { transform: atRest },
        ],
      },
    ];
  }
  return { draw, frames, duration: 1280 };
})();
