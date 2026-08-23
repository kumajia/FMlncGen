# FMlncGen — .lnc Code Generator

> **Development note**
>
> This README documents the **current public version** of FMlncGen.
> A newer major version, **FMlncGen 2.0 / Dictionary Engine**, is currently under active development and has not been released yet.
> In other words, the functionality described below belongs to the generation **before the version currently being developed**.

FMlncGen is a browser-based tool for automatically transliterating Football Manager club names, competition names, player names, and stadium names into Japanese katakana and generating `.lnc` code.

It runs entirely in the browser. Your data stays on your device except when translation or image extraction is sent to an AI API. Translation and image extraction can use either **Google Gemini** or **Groq**.

## Usage

1. Open `index.html` (or the hosted URL) in a browser. Chrome or Edge is recommended.
2. Select an **API provider** (Gemini or Groq) and enter the corresponding **API key**.
3. Select the target type: **Club / Competition / Player / Stadium**.
4. Paste the data and start parsing and translation.
5. Review or edit the translated names in the table, then generate the `.lnc` code and copy or save it.

You can also import names from **screenshots** instead of entering them manually. FMlncGen can read names and IDs from Football Manager screenshots and add them to the input list automatically. Screenshot extraction uses the currently selected provider; Gemini is generally the safer choice for image-reading accuracy.

## Generated `.lnc` Code

### Club

Two lines are generated: LONG and SHORT.

| Code | Purpose | Example |
|---|---|---|
| `CLUB_LONG_NAME_CHANGE` | Japanese katakana club name | `ヴィキングル レイキャヴィーク` |
| `CLUB_SHORT_NAME_CHANGE` | Short display name | `ヴィキングル` |

### Competition

| Code | Purpose |
|---|---|
| `COMP_LONG_NAME_CHANGE` | Japanese katakana competition name |
| `COMP_SHORT_NAME_CHANGE` | Short display name |

### Player

```text
"CHANGE_PLAYER_NAME" 45 "" "パオロ マルディーニ"
```

### Stadium

```text
"STADIUM_NAME_CHANGE" 102618 "セルティック パーク"
```

For clubs and competitions, the LONG name uses the translated result plus any detected prefix. The SHORT name can be edited independently; if left empty, the LONG value is used instead. Players and stadiums do not use SHORT names.

Football abbreviations and initials such as `FC`, `KVK`, `RES`, `VV`, and `SV` are detected as prefixes and preserved instead of being translated.

## Input Format

Enter one item per line:

```text
KE Wervik 539859
Wanze Bas Oha 132456
```

- The number at the end of the line is treated as the Football Manager ID.
- Leading uppercase abbreviations such as `FC` are treated as prefixes.

## Country Hints for Club Pronunciation

For club names, FMlncGen can use the country as a hint to produce katakana closer to the pronunciation used in that country.

The easiest method is to import a screenshot where the club name, ID, and country are visible together.

![Example screen showing country information](country-example.png)

Screenshot extraction writes entries such as:

```text
Komgrap [セルビア] 5745713
```

- The country is used only as a translation hint.
- It is not included in the generated `.lnc` file.
- If no country is supplied, FMlncGen estimates the likely language area from the spelling.

Country information does not guarantee a perfect local pronunciation because the result still depends on AI inference. Review important names manually and add corrected results to the dictionary when needed.

## API Keys

Translation and image extraction require either a Gemini key or a Groq key.

### Gemini

1. Open Google AI Studio.
2. Create an API key from **Get API key**.
3. Paste it into the **Gemini API key** field in FMlncGen.

### Groq

1. Open the Groq Console.
2. Open **API Keys** and select **Create API Key**.
3. Copy the full key when it is shown and paste it into the **Groq API key** field.

Notes:

- You can enter one provider key or both.
- The selected provider is used for translation and image extraction.
- API keys are stored only in your browser's `localStorage`.
- FMlncGen does not send your API key to its own server.
- Gemini is generally more reliable for screenshot recognition.

## Dictionary File (`fm_dictionary.json`)

`fm_dictionary.json` contains translations for commonly used names.

- Importing it lets matching names be translated immediately without an AI request.
- If browser data is cleared, the dictionary can be imported again.
- A user-maintained dictionary can be exported for backup.

## File Structure

| File | Purpose |
|---|---|
| `index.html` | Main application |
| `manifest.json` | PWA metadata |
| `sw.js` | Offline/PWA support |
| `icon-192.png` / `icon-512.png` | Application icons |
| `fm_dictionary.json` | Initial dictionary |

## Install as a PWA

When FMlncGen is opened from a hosted site such as GitHub Pages, supported browsers can install it as a standalone desktop-style application.

After the application has been opened once, it can launch offline. AI translation still requires an internet connection.

## UI Languages

The interface currently supports:

- 日本語
- English
- 简体中文
- 한국어
- Deutsch
- Français
- Latina
- עברית

The translation target itself is fixed to **Japanese katakana**.

## Important Notes

- AI transliteration may differ from an official or preferred spelling. Review and edit generated names before using them.
- Generated `.lnc` files are placed in the Football Manager `…/Shared/Database/DB/<version>/LNC/All` folder.
- Player-name changes apply globally because Football Manager does not separate them by language.
- Stadium-name changes may not work for every target or every Football Manager version.

## Input Validation, Line Endings, and Error Logs

- Lines without a valid numeric ID at the end are reported as unreadable and skipped.
- Duplicate IDs are reported before generation.
- Saved and copied `.lnc` output uses **CRLF (`\r\n`)** line endings, UTF-8, without BOM.
- Characters that could break `.lnc` syntax are removed during generation.
- Error logs can be saved as `.log` files for bug reports.

## Features

- Club / Competition / Player / Stadium modes
- Gemini / Groq provider switching
- Automatic model discovery
- Batch translation
- Dictionary-only translation
- Automatic duplicate reuse
- Automatic work save/restore
- Stop translation/extraction
- Add all results to the user dictionary
- Import existing `.lnc` files
- Show only items requiring attention

## Development Status

The version documented in this README is the **current public/previous-generation implementation**.

A significantly expanded version, **FMlncGen 2.0 / Dictionary Engine**, is being developed separately. That work includes a new dictionary/resolution architecture and compatibility testing, but it is **not yet the released version described by this README**.

This distinction is important when reviewing the repository or discussing development data: the public version and the in-development Dictionary Engine should not be assumed to have identical behavior.

## Data Collaboration

FMlncGen is a **non-commercial project**.

For development and compatibility testing, the project may collaborate with data providers on minimal datasets such as:

- Football Manager club ID
- Original/source club name

This data is used to validate name resolution and translation compatibility.

Data supplied by third parties will **not be redistributed unless explicit permission has been given**. If requested, supplied datasets can remain private and be used only for development and validation.

For collaborators, a simple mapping such as the following is sufficient:

```text
fm_id,club_name
539859,KE Wervik
```

No additional fields are required for this use case.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
