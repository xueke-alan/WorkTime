import { fsrs, createEmptyCard, generatorParameters } from "ts-fsrs";
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false }));
globalThis.WorkTimeFSRS = {
  review(previous, grade, time) {
    const now = new Date(time);
    const card = previous ? { ...previous, due: new Date(previous.due), last_review: previous.last_review ? new Date(previous.last_review) : undefined } : createEmptyCard(now);
    return JSON.parse(JSON.stringify(scheduler.next(card, now, grade)));
  },
};
