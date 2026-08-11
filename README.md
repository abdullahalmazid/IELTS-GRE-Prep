# Wordbank — IELTS & GRE vocabulary

A single page that reads its words from JSON. No build step, no framework,
no dependencies.

## Running it

The page fetches its own data files, and browsers forbid that when a page is
opened straight from disk (`file://`). So it needs a server — any server:

```
cd wordbank
python -m http.server
```

Then open <http://localhost:8000/>. If you upload the folder to your site it
just works, no server command needed.

Double-clicking `index.html` will show a message explaining this rather than
a blank page.

## The folder

```
wordbank/
├─ index.html                 the whole interface — no word data inside
├─ assets/
│  ├─ style.css               your site's design system, unchanged
│  ├─ vocab.css               additions for this page only
│  └─ app.js                  all the logic
└─ data/
   ├─ manifest.json           the index: which letters exist, which files
   ├─ words/
   │  ├─ a/part-01.json       words beginning with A
   │  ├─ b/part-01.json
   │  └─ … one folder per letter, a–z
   └─ quiz/
      ├─ config.json          round length, question types, weights
      └─ sets/                optional hand-written questions
```

## Adding words

Open the letter's file, e.g. `data/words/m/part-01.json`, and append an entry:

```json
{
  "id": 700,
  "word": "mendacious",
  "pos": "adjective",
  "level": "GRE",
  "list": 7,
  "def": "Given to lying; untruthful.",
  "syn": ["deceitful", "untruthful", "duplicitous"],
  "ant": ["honest", "truthful"],
  "ex": "The report rests on a mendacious account of the meeting."
}
```

Every field matters:

| Field   | Notes |
|---------|-------|
| `id`    | Unique across the whole collection. Progress is saved against it, so don't renumber existing words. |
| `level` | `IELTS`, `GRE` or `BOTH`. Decides which tab the word appears on. |
| `list`  | Difficulty band, shown on the card. Any number. |
| `syn` / `ant` | Arrays. An empty array is fine — the card says "not recorded" and the quiz skips that question type for the word. |
| `ex`    | Include the word itself; the page bolds it automatically and blanks it for gap-fill questions. |

Then update that letter's `count` in `data/manifest.json`.

### When a letter file gets long

Past roughly 250 words, start a new part rather than growing one file:

1. Create `data/words/a/part-02.json` with the next batch.
2. Add it to the manifest:

```json
{ "letter": "a", "parts": ["part-01.json", "part-02.json"], "count": 340 }
```

The page loads every part listed and concatenates them. Nothing else changes.

### Totals

`totals` in the manifest feeds the four figures on the Home tab. Update it
when you add words, or the numbers will drift. Nothing breaks if you forget —
the counts are only cosmetic.

## The quiz

`data/quiz/config.json` controls it. `roundLength` sets the number of
questions, `types` sets which kinds appear and how often. Raise a `weight` to
see that kind more often; delete a type to drop it. A type is skipped
automatically for any word lacking what it needs — a word with no antonyms
never produces an "opposite" question.

## Saved progress

Words marked learned and spelling scores live in the browser's local storage
under `vocab.progress.v2`. They're per-browser and per-device, not synced. If
storage is unavailable the page still runs; progress just resets on reload.
