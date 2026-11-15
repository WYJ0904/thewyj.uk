/* Task 27 Email Center template newline hygiene: controlled incremental migration 0037 */

UPDATE email_center_templates
SET
  body_template = REPLACE(REPLACE(body_template, '\r\n', char(10)), '\n', char(10)),
  subject_template = REPLACE(REPLACE(subject_template, '\r\n', char(10)), '\n', char(10)),
  updated_at = '2026-11-15T12:45:00.000Z'
WHERE updated_by = 'system'
  AND (
    body_template LIKE '%\n%'
    OR subject_template LIKE '%\n%'
  );
