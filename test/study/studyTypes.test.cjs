const assert = require("node:assert/strict");
const test = require("node:test");

const { parseStudyStateFile } = require("../../out-test/study/types");

function stateWithProblem(problem) {
    return {
        version: 1,
        backlog: {
            "42": {
                questionNumber: "42",
                problem,
                addedAt: "2026-08-19T10:00:00.000Z",
                updatedAt: "2026-08-19T10:00:00.000Z",
            },
        },
        dailyPlans: {},
    };
}

test("version-1 study state parses missing companies as an empty compatibility default", () => {
    const parsed = parseStudyStateFile(stateWithProblem({
        name: "Problem 42",
        difficulty: "Easy",
        url: "https://example/42",
        tags: ["Array"],
        sheets: ["Blind"],
    }));

    assert.deepEqual(parsed.backlog["42"].problem.companies, []);
});

test("version-1 study state preserves serialized company metadata", () => {
    const parsed = parseStudyStateFile(stateWithProblem({
        name: "Problem 42",
        difficulty: "Easy",
        url: "https://example/42",
        tags: ["Array"],
        sheets: ["Blind"],
        companies: ["Current Company"],
    }));

    assert.deepEqual(parsed.backlog["42"].problem.companies, ["Current Company"]);
});
