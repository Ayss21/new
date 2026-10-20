# DemandIQ data dictionary

Every table and column of the backend seed: its type, its key, the field it becomes in the API
(`docs/API_CONTRACT.md`) and what it holds. `schema.sql` has the same notes as table and column comments,
so pgAdmin and `\d+ table` in psql show them too.

**Key / null**: PK = primary key · → `table` = foreign key to that table · unique = no two rows share it ·
NULL = may be empty (every other column is required) · default FC-0001 … = new rows get the next ID in
that format.

**API field**: where the value goes in the API's JSON. Empty when the API uses the column's name in
camelCase; "(not sent)" when the API never sends it. A row's own key is `id` in the API.
