"use strict";
/** Original curriculum: reproducible exercises, staged key coverage, no remote assets. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const en = [
  ["home", "asdfjkl;", 5, 10],
  ["reach", "asdfghjkl;", 8, 15],
  ["upper", "qwertyuiopasdfghjkl;", 10, 20],
  ["lower", "abcdefghijklmnopqrstuvwxyz;", 12, 25],
  ["alphabet", "abcdefghijklmnopqrstuvwxyz;", 15, 30],
  ["commonWords", "abcdefghijklmnopqrstuvwxyz;", 20, 35],
  ["capitals", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ;", 20, 40],
  [
    "punctuation",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ;.,!?':\"-",
    25,
    45,
  ],
  [
    "numbers",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ;.,!?':\"-0123456789",
    25,
    45,
  ],
  [
    "symbols",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?",
    25,
    50,
  ],
  [
    "sentences",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?",
    30,
    55,
  ],
  [
    "articles",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?",
    35,
    60,
  ],
];
const words =
  "a as ask sad lad lads lass fall falls flask salad salads dad dads add adds all alfalfa ash gas glass glad flag flags half hall shall dash flash gala has had hash lash hag gag jag jazz fish dish fill hill silk skill kill sill ill dill lid did dig jig kid gild guild frill drill thrill hush rush lush slug shrug mug gum hum sum run sun fun bun nut hut cut cup pup put pit tip top pot pop rip trip grip ship shop stop spot step keep seek peek week deep sleep green red blue white black gray gold silver soft warm cool clear clean bright quiet quick slow small tall short long wide narrow new old young kind calm brave open close read write type learn teach think build make move hold look listen share care help grow play plan work rest walk cycle train garden forest river valley stone cloud rain snow wind light night morning evening day time home house room door window table chair book page pen paper note hand finger left right space line word letter sound music story lesson review steady focus practice patience progress finish start fresh little simple useful careful steady daily happy healthy friend family planet ocean meadow mountain travel welcome keyboard computer screen number symbol accurate speed rhythm balance return enter shift control where there their what when why which how some more most each every many other again always often never with from into over under after before about between through around today tomorrow together we you they he she it our your my his her its can could will would should may must is are was were be been have do does go see get give take find tell say use need want try let set first second third four five six seven eight nine ten zero apple orange lemon peach grape berry bread soup rice bean seed leaf tree bird cat dog fox bear wolf deer horse mouse otter robin owl kite lake park path field coast north south east west round square circle triangle map list goal score daily weekly monthly season spring summer autumn winter meet team task project office email message reply hello thanks please yes no true false function value const array object string boolean null data input output error success file folder save load backup local offline browser network memory system safety design color shape layout theme language english chinese beginner advanced complete continue repeat improve welcome".split(
    /\s+/,
  );
const paragraphs = [
  "A quiet morning gives us time to notice small things. The light moves across the room while a warm cup rests beside an open book. There is no need to hurry. One careful action can set a steady rhythm for the whole day.",
  "The little garden began with a handful of seeds. We checked the soil each morning and watered only when it felt dry. After a week, green leaves appeared. Patient care turned a bare corner into a place full of life.",
  "Learning a new skill takes practice and rest. Start with a clear goal, work slowly enough to stay accurate, and notice what feels difficult. A short review tomorrow is often more useful than a long session when you are tired.",
  "Our team keeps a simple notebook of useful ideas. Each page describes one problem and a small next step. When a plan changes, we explain the reason. Clear notes help everyone return to the work with confidence.",
  "At the river, the path follows a gentle curve beneath the trees. Birds gather near the reeds, and a small bridge leads toward the village. We stop to read a map before choosing the longer route home.",
  "A good story can begin with an ordinary object. Imagine a blue key found inside an old coat. Who left it there, and what might it open? Write a few sentences, then read them aloud to hear their rhythm.",
  "The library offers a quiet space for curious minds. Some visitors come to study, others to discover a new writer. A helpful sign makes each shelf easy to find. Everyone can leave with a question worth exploring.",
  "Before a journey, we make a short list of what matters. Water, a light jacket, and a charged phone are usually enough for a local walk. Check the weather, tell a friend the route, and leave time to enjoy the view.",
  "Cooking together is a lesson in timing. One person washes vegetables while another prepares the rice. We taste the soup, adjust the heat, and clear the table. A simple meal feels special when everyone helps.",
  "The workshop has a place for every tool. We measure twice before cutting a piece of wood and keep the floor clear. At the end of the afternoon, the new shelf fits perfectly beside the window.",
];
function rng(seed) {
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}
const catalog = { en: [] };
const all = [];
function write(file, value) {
  const target = path.join(root, file);
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== value)
      throw Error("Stale curriculum: " + file);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}
for (let chapter = 0; chapter < en.length; chapter++) {
  const [key, keys, low, high] = en[chapter],
    lessons = [];
  const random = rng(8101 + chapter * 77);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const vocabulary = words.filter((word) =>
    [...word].every((c) => keys.includes(c)),
  );
  for (let i = 0; i < 50; i++) {
    const type = ["keys", "patterns", "words", "review", "checkpoint"][i % 5];
    let text;
    if (chapter < 5 && i % 5 < 2) {
      const current = keys.replace(/;/g, ""),
        focus = current[Math.floor(i / 2) % current.length];
      text = Array.from({ length: 12 + Math.floor(i / 10) }, () =>
        Array.from({ length: 2 + (i % 3) }, (_, k) =>
          k === 0 ? focus : pick([...keys]),
        ).join(""),
      ).join(" ");
    } else if (chapter >= 10) {
      const base = paragraphs[(i + chapter) % paragraphs.length];
      const extra = paragraphs[(i * 3 + 2) % paragraphs.length];
      text =
        i % 5 === 0
          ? `${base} ${extra}`
          : `${base
              .split(". ")
              .slice(i % 3)
              .join(". ")} ${extra.split(". ")[i % 3]}.`;
      // Give every lesson its own meaningful selection/order of text.
      text += ` ${["Keep your hands relaxed.", "Focus on a steady rhythm.", "Review the words that need care.", "Accuracy improves with patience.", "Pause and stretch when needed."][i % 5]} ${["Read ahead before typing.", "Return to the home row.", "Let each sentence flow.", "Finish with a careful review.", "Notice the spaces between words."][Math.floor(i / 5) % 5]}`;
    } else {
      const selected = Array.from(
        { length: 15 + Math.floor(i / 5) + chapter },
        () => pick(vocabulary),
      );
      if (chapter >= 6)
        for (let j = 0; j < selected.length; j += 4)
          selected[j] = selected[j][0].toUpperCase() + selected[j].slice(1);
      if (chapter >= 7)
        for (let j = 2; j < selected.length; j += 5)
          selected[j] += pick([",", ".", "!", "?", ";", ":"]);
      if (chapter === 8)
        for (let j = 1; j < selected.length; j += 4)
          selected[j] = String(Math.floor(random() * 10000));
      if (chapter === 9)
        for (let j = 1; j < selected.length; j += 3)
          selected[j] = [
            "[]",
            "{}",
            "()",
            "<>",
            "@",
            "#",
            "$",
            "%",
            "^",
            "&",
            "*",
            "_",
            "+",
            "=",
            "\\",
            "|",
            "~",
            "`",
            "/",
          ][Math.floor(i / 3 + j) % 19];
      text = selected.join(" ");
    }
    const number = chapter * 50 + i + 1;
    const lesson = {
      id: `en-${String(number).padStart(3, "0")}`,
      language: "en",
      chapter,
      number,
      type,
      text,
      keys: keys + " ",
      goal: Math.round(low + ((high - low) * i) / 49),
      source: "original",
    };
    lessons.push(lesson);
    all.push(lesson);
  }
  catalog.en.push({
    key,
    count: 50,
    first: chapter * 50 + 1,
    low,
    high,
    path: `assets/data/typing/en-${chapter + 1}.js`,
  });
  write(
    `assets/data/typing/en-${chapter + 1}.js`,
    `"use strict";\nWorkTimeApp.data.typingLessons.en[${chapter}] = ${JSON.stringify(lessons)};\n`,
  );
}
write(
  "assets/data/typing/catalog.js",
  `"use strict";\nWorkTimeApp.data.typingCatalog = ${JSON.stringify(catalog)};\nWorkTimeApp.data.typingLessons = { en: {} };\n`,
);
if (new Set(all.map((lesson) => lesson.text)).size !== 600)
  throw Error("Duplicate typing lessons");
console.log("Generated 600 English original typing lessons.");
