-- A profile managed by coach $1, with no credentials.
INSERT INTO users (name, weight_unit, locale, managed_by)
VALUES ($2, $3, $4, $1)
RETURNING id;
