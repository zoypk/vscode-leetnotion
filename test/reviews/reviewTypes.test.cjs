const assert = require("node:assert/strict");
const test = require("node:test");
const { Rating, createEmptyCard, fsrs } = require("ts-fsrs");

const { parseReviewStateFile } = require("../../out-test/reviews/types");

function validState() {
    return {
        version: 1,
        reviews: {
            "42": {
                questionNumber: "42",
                problem: {
                    name: "Trapping Rain Water",
                    difficulty: "Hard",
                    url: "https://example/42",
                },
                fsrsCard: {
                    due: "2026-08-20T10:00:00.000Z",
                    stability: 4.5,
                    difficulty: 6.25,
                    elapsed_days: 3,
                    scheduled_days: 5,
                    learning_steps: 0,
                    reps: 2,
                    lapses: 1,
                    state: 2,
                    last_review: "2026-08-15T10:00:00.000Z",
                },
                createdAt: "2026-08-10T10:00:00.000Z",
                updatedAt: "2026-08-15T10:00:00.000Z",
                lastReviewedAt: "2026-08-15T10:00:00.000Z",
                lastRating: "good",
            },
        },
    };
}

function mutate(mutator) {
    const state = validState();
    mutator(state.reviews["42"], state);
    return state;
}

test("accepts canonical new and non-new ts-fsrs cards", () => {
    assert.deepEqual(parseReviewStateFile(validState()), validState());
    const newCard = mutate((record) => {
        record.fsrsCard = {
            ...record.fsrsCard,
            stability: 0,
            difficulty: 0,
            elapsed_days: 0,
            scheduled_days: 0,
            learning_steps: 0,
            reps: 0,
            lapses: 0,
            state: 0,
            last_review: null,
        };
    });
    assert.equal(parseReviewStateFile(newCard).reviews["42"].fsrsCard.state, 0);
});

test("rejects records whose key does not equal questionNumber", () => {
    assert.throws(
        () => parseReviewStateFile(mutate((record) => { record.questionNumber = "43"; })),
        /questionNumber must equal its review key 42/,
    );
});

test("rejects invalid FSRS state values", () => {
    for (const state of [-1, 4, 1.5]) {
        assert.throws(
            () => parseReviewStateFile(mutate((record) => { record.fsrsCard.state = state; })),
            /fsrsCard\.state must be an integer from 0 to 3/,
        );
    }
});

test("rejects negative or fractional FSRS counters", () => {
    for (const field of ["reps", "lapses", "scheduled_days", "elapsed_days", "learning_steps"]) {
        for (const value of [-1, 1.5]) {
            assert.throws(
                () => parseReviewStateFile(mutate((record) => { record.fsrsCard[field] = value; })),
                new RegExp(`fsrsCard\\.${field} must be a nonnegative integer`),
            );
        }
    }
});

test("rejects invalid FSRS stability, difficulty, and lapse relationships", () => {
    const cases = [
        [(record) => { record.fsrsCard.stability = -0.1; }, /stability must be at least 0/],
        [(record) => { record.fsrsCard.difficulty = 10.1; }, /difficulty must be between 0 and 10/],
        [(record) => { record.fsrsCard.lapses = 3; }, /lapses must not exceed .*reps/],
    ];
    for (const [change, expected] of cases) {
        assert.throws(() => parseReviewStateFile(mutate(change)), expected);
    }
});

test("accepts an actual ts-fsrs forgotten card with retained reps and last_review", () => {
    const scheduler = fsrs();
    const firstReview = new Date("2026-08-10T10:00:00.000Z");
    const scheduled = scheduler.next(createEmptyCard(firstReview), firstReview, Rating.Good).card;
    const forgotten = scheduler.forget(scheduled, new Date("2026-08-11T10:00:00.000Z"), false).card;
    const state = validState();
    state.reviews["42"].fsrsCard = {
        due: forgotten.due.toISOString(),
        stability: forgotten.stability,
        difficulty: forgotten.difficulty,
        elapsed_days: forgotten.elapsed_days,
        scheduled_days: forgotten.scheduled_days,
        learning_steps: forgotten.learning_steps,
        reps: forgotten.reps,
        lapses: forgotten.lapses,
        state: forgotten.state,
        last_review: forgotten.last_review.toISOString(),
    };

    const parsed = parseReviewStateFile(state).reviews["42"].fsrsCard;

    assert.equal(parsed.state, 0);
    assert.equal(parsed.stability, 0);
    assert.equal(parsed.difficulty, 0);
    assert.equal(parsed.reps, scheduled.reps);
    assert.equal(parsed.elapsed_days, 0);
    assert.equal(parsed.scheduled_days, 0);
    assert.equal(parsed.learning_steps, 0);
    assert.equal(new Date(parsed.last_review).getTime(), forgotten.last_review.getTime());
});

test("rejects new cards with nonzero stability or difficulty", () => {
    const baseNewCard = (record) => {
        record.fsrsCard.state = 0;
        record.fsrsCard.stability = 0;
        record.fsrsCard.difficulty = 0;
        record.fsrsCard.reps = 0;
        record.fsrsCard.lapses = 0;
        record.fsrsCard.last_review = null;
    };
    const cases = [
        (record) => { baseNewCard(record); record.fsrsCard.stability = 1; },
        (record) => { baseNewCard(record); record.fsrsCard.difficulty = 1; },
    ];
    for (const change of cases) {
        assert.throws(() => parseReviewStateFile(mutate(change)), /new FSRS card/);
    }
});

test("rejects new cards with nonzero scheduling counters", () => {
    for (const field of ["elapsed_days", "scheduled_days", "learning_steps"]) {
        assert.throws(() => parseReviewStateFile(mutate((record) => {
            record.fsrsCard.state = 0;
            record.fsrsCard.stability = 0;
            record.fsrsCard.difficulty = 0;
            record.fsrsCard.elapsed_days = 0;
            record.fsrsCard.scheduled_days = 0;
            record.fsrsCard.learning_steps = 0;
            record.fsrsCard[field] = 1;
        })), new RegExp(`new FSRS card ${field} must be zero`));
    }
});

test("rejects non-new cards without learned-card values", () => {
    const cases = [
        [(record) => { record.fsrsCard.stability = 0; }, /non-new FSRS card stability must be greater than 0/],
        [(record) => { record.fsrsCard.difficulty = 0; }, /non-new FSRS card difficulty must be between 1 and 10/],
        [(record) => { record.fsrsCard.last_review = null; }, /non-new FSRS card must have last_review/],
    ];
    for (const [change, expected] of cases) {
        assert.throws(() => parseReviewStateFile(mutate(change)), expected);
    }
});

test("normalizes every accepted review date to canonical ISO output", () => {
    const state = mutate((record) => {
        record.fsrsCard.due = "2026-08-20";
        record.fsrsCard.last_review = "2026-08-15T15:30:00+05:30";
        record.createdAt = "2026-08-10T10:00:00Z";
        record.updatedAt = "2026-08-15T12:00:00+02:00";
        record.lastReviewedAt = "2026-08-15T10:00:00.125+00:00";
    });

    const parsed = parseReviewStateFile(state).reviews["42"];

    assert.equal(parsed.fsrsCard.due, "2026-08-20T00:00:00.000Z");
    assert.equal(parsed.fsrsCard.last_review, "2026-08-15T10:00:00.000Z");
    assert.equal(parsed.createdAt, "2026-08-10T10:00:00.000Z");
    assert.equal(parsed.updatedAt, "2026-08-15T10:00:00.000Z");
    assert.equal(parsed.lastReviewedAt, "2026-08-15T10:00:00.125Z");
});

test("accepts a valid Gregorian leap day", () => {
    const parsed = parseReviewStateFile(mutate((record) => {
        record.fsrsCard.due = "2024-02-29";
    })).reviews["42"];

    assert.equal(parsed.fsrsCard.due, "2024-02-29T00:00:00.000Z");
});

test("normalized boundary years remain valid when reparsed", () => {
    const cases = [
        ["9999-12-31T23:59:59-14:00", "+010000-01-01T13:59:59.000Z"],
        ["0000-01-01T00:00:00+14:00", "-000001-12-31T10:00:00.000Z"],
    ];
    for (const [input, expected] of cases) {
        const normalized = parseReviewStateFile(mutate((record) => {
            record.fsrsCard.due = input;
        })).reviews["42"].fsrsCard.due;
        assert.equal(normalized, expected);

        const reparsed = parseReviewStateFile(mutate((record) => {
            record.fsrsCard.due = normalized;
        })).reviews["42"].fsrsCard.due;
        assert.equal(reparsed, expected);
    }
});

test("rejects negative-zero expanded years", () => {
    assert.throws(() => parseReviewStateFile(mutate((record) => {
        record.fsrsCard.due = "-000000-01-01T00:00:00Z";
    })), /must be a valid ISO-8601 date/);
});

test("rejects non-ISO, rollover, and out-of-range review dates", () => {
    const cases = [
        (record) => { record.fsrsCard.due = "2026-02-30"; },
        (record) => { record.fsrsCard.due = "2025-02-29"; },
        (record) => { record.fsrsCard.last_review = "08/19/2026"; },
        (record) => { record.createdAt = "0"; },
        (record) => { record.updatedAt = "2026-13-01"; },
        (record) => { record.lastReviewedAt = "2026-08-19T24:00:00Z"; },
        (record) => { record.fsrsCard.due = "2026-08-19T10:60:00Z"; },
        (record) => { record.fsrsCard.due = "2026-08-19T10:00:60Z"; },
        (record) => { record.fsrsCard.due = "2026-08-19T10:00:00+14:01"; },
        (record) => { record.fsrsCard.due = "2026-08-19T10:00:00+15:00"; },
        (record) => { record.fsrsCard.due = "2026-08-19 10:00:00Z"; },
        (record) => { record.fsrsCard.due = "2026-08-19T10:00:00"; },
    ];
    for (const change of cases) {
        assert.throws(() => parseReviewStateFile(mutate(change)), /must be a valid ISO-8601 date/);
    }
});
