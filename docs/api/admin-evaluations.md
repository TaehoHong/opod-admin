# Admin evaluations

Read access to the plan/prompt evaluations produced by `EvaluationWorkerService`,
plus the manually triggered offline aggregation report. Design:
`docs/plan-prompt-evaluation-agent.md`.

```http
GET  /api/admin/v1/drafts/:id/evaluations
POST /api/admin/v1/evaluations/worker/run
POST /api/admin/v1/evaluation-reports
GET  /api/admin/v1/evaluation-reports
GET  /api/admin/v1/evaluation-reports/:id
```

## Draft evaluations

Returns every evaluation attempt for a draft, latest attempt first within each
`kind`. An unknown draft yields an empty array rather than a 404 — the draft
detail endpoint already distinguishes that case, and evaluations are reference
data the review screen must never block on.

`scores` is the raw `scores_json` and its shape depends on `kind`:

- `plan` — `{ scores: { <dimension>: { score, reason } } }`, eight dimensions.
- `prompt` — `{ shots: [{ sortOrder, jobId, scores, issues, lint }], crossShot }`.
  `jobId` pins which generation job was judged, so a later shot regeneration
  does not make the score ambiguous. `lint` holds the static Layer 1 findings,
  kept separate from the LLM verdict because the two differ in trustworthiness.

## Run the evaluation worker manually

```http
POST /api/admin/v1/evaluations/worker/run
```

No body. Claims and processes at most one pending evaluation per `kind` and
returns which ones actually ran:

```json
{ "evaluated": ["plan"] }
```

An empty array means nothing was pending — that is a normal 200, not an error.
The call works regardless of the `evaluationWorkerEnabled` switch, which only
controls the automatic polling loop; running one evaluation by hand before
turning the loop on is the intended way to check the judge configuration.

Unlike the generation worker's manual run, this one is **synchronous**: an
evaluation is a single LLM call and the point of the button is to see the
result now. Expect the request to stay open for the duration of that call.

If both evaluators are unconfigured the endpoint returns an empty array without
claiming anything, so a missing judge key never accumulates failed rows.

## Evaluation reports

`POST /evaluation-reports` runs the aggregation now and persists the result;
there is no scheduled run yet. The body accepts optional ISO 8601 `from` and
`to`; the default window is the trailing seven days. A period whose start does
not precede its end is a 400.

Only the current `EVAL_RUBRIC_VERSION` window is aggregated. Mixing rubric
versions would average scores whose meaning changed, so a rubric bump starts a
fresh series rather than extending the old one.

`summaryJson` splits every figure by `contentLanguage` — AI-tell patterns and
platform conventions differ per language, so a merged average hides the thing
the report exists to surface. Within a language it carries per-dimension score
distributions ordered worst-first, the human signals joined from the same query
(rejection, shot regeneration, caption editing, candidate selection), and the
two rubric-mismatch sample sets: high-scoring drafts a human rejected, and
low-scoring drafts a human approved. Those samples are the evidence for rubric
correction.

`failurePatternsJson` counts recurring issues per dimension with sample draft
IDs. It is deterministic counting, not LLM clustering — improvement-proposal
generation is phase 3 and `promptSuggestionsJson` stays empty until then.
