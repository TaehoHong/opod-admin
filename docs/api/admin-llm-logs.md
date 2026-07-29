# Admin LLM logs

All active admins can read external model execution logs.

```http
GET /api/llm-logs
GET /api/llm-logs/:id
```

The list supports `status`, `type`, `provider`, `model`, `requestId`,
`generationJobId`, `from`, `to`, `cursor`, and `limit`. IDs are serialized as
strings because `llm_logs.id` is `BIGINT`.

The detail response includes separated system/user prompts, the redacted
provider request and response, usage/error/timing fields, and ordered
`input`/`output` media relations. Generated media is displayed from the
persisted `Media.url`, never from a provider's temporary result URL.

There is intentionally no delete API or UI. `llm_logs`, `llm_log_media`, linked
`media` rows, and their S3 originals are retained indefinitely, including after
user withdrawal. S3 lifecycle rules must exclude objects referenced by
`llm_log_media`; the database foreign key restricts deletion of linked media.
