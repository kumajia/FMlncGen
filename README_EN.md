# FMlncGen — .lnc Code Generator

FMlncGen is a browser-based tool for automatically transliterating Football Manager club names, competition names, player names, and stadium names into Japanese katakana and generating `.lnc` code.

It runs entirely in the browser. Your data stays on your device; the app only talks to the AI provider you selected when it translates, extracts names from images, or loads the model list. Translation and image extraction can use either **Google Gemini** or **Groq**.

- Hosted version: https://kumajia.github.io/FMlncGen/
- 日本語: [README.md](README.md)
- Version shown in the app: v2.0.0 (history in [CHANGELOG.md](CHANGELOG.md))

## Usage

The screen arrangement differs between UI layouts (see below), but the steps and the button names are the same in every layout. Look for the headings or navigation items **Connect**, **Input**, **Review**, **Output** and **Dictionary**.

1. **Connect**: Open the hosted URL (or `index.html`) in a browser (Chrome or Edge recommended). Under **AI connection**, select an **API provider** (Gemini or Groq) and enter the matching **API key** (see below for how to get one). Once a key is entered, the list of available models loads automatically.
2. **Input**: Select the **Target** (Club / Competition / Player / Stadium) and paste your data. You can also read names from screenshots.
3. **Convert**: Press **Parse & Translate**. Names found in your dictionary are translated from it; the rest are sent to the AI.
4. **Review and fix**: Check the readings in the review table and correct them if needed. Yellow marks an AI reading or a new word. **Save edits to user dictionary** keeps your corrections for next time.
5. **Save the .lnc**: Press **Generate .lnc code**, then **Copy to clipboard** or **Save as .lnc file**.

You can also import names from **screenshots** instead of entering them manually. FMlncGen can read names and IDs from Football Manager screenshots and add them to the input list automatically. Screenshot extraction uses the currently selected provider; Gemini is generally the safer choice for image-reading accuracy.

## UI Layouts and Colour Theme

The same features are available in seven screen arrangements. Every layout can do the same things.

| Layout | What it looks like |
|---|---|
| Matchday Desk | The default. A balanced layout styled like a broadcast desk, with a scoreboard and a fixture-list style review |
| Split Studio | An editor workbench: numbered editors and a spreadsheet-style review grid side by side. Connection settings and the dictionary open in drawers |
| Kickoff Guide | A friendly wizard with a connected progress track and roomy question cards, one step per screen |
| Command Deck | A monospace terminal. `Ctrl+K` (`Cmd+K` on a Mac) opens the command palette, `/` jumps to the input box, `Ctrl+Enter` runs |
| Review Board | A chat-style composer and review cards, with a receipt-style output |
| Clubhouse Rail | An app-style layout with a navy-and-gold club rail (navigation), one task per page |
| Programme | An editorial match-programme style: serif chapters, ruled fields and a team-sheet review |

- **Opening the chooser**: Every layout has a layout icon button (accessible name **Choose UI layout**) that opens the **Appearance** dialog. Layouts that have a **UI layout** button in their settings area can open it from there too. In Command Deck, the palette command **Choose UI layout** opens it as well.
- **Switching**: Selecting a card switches the screen immediately. The **Appearance** dialog stays open, so close it with its close button or `Esc`.
- **Your work carries over**: Your input, edited readings, generated `.lnc` and dictionary search stay as they are. Switching alone never starts a translation or a model-list reload.
- **Colour theme**: In the **Appearance** dialog, **Colour theme** offers **Auto / Light / Dark**. It is independent of the layout. **Auto** follows the light or dark setting of your OS or browser.
- **After a reload**: The chosen layout and theme are saved in the browser and come back after a reload or the next launch.

## Generated `.lnc` Code

The code that is generated depends on the selected target.

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

One line, applied to all languages.

```text
"CHANGE_PLAYER_NAME" 45 "" "パオロ マルディーニ"
```

### Stadium

```text
"STADIUM_NAME_CHANGE" 102618 "セルティック パーク"
```

For clubs and competitions, the LONG name uses the translated result plus any detected prefix. The SHORT name can be edited independently; if left empty, the LONG value is used instead. Players and stadiums do not use SHORT names, so the SHORT column is hidden for them.

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

- You can also add `[country]` by hand to get the same hint.
- The country is used only as a translation hint.
- It is not included in the generated `.lnc` file.
- If no country is supplied, FMlncGen estimates the likely language area from the spelling.

Country information does not guarantee a perfect local pronunciation because the result still depends on AI inference. Review important names manually and add corrected results to the dictionary when needed.

## API Keys

Translation and image extraction require either a Gemini key or a Groq key.

### Gemini

1. Open Google AI Studio (https://aistudio.google.com).
2. Create an API key from **Get API key**.
3. Paste it into the **Gemini API key** field in FMlncGen.

### Groq

1. Open the Groq Console (https://console.groq.com).
2. Open **API Keys** and select **Create API Key** (`gsk_...`).
3. Copy the full key when it is shown (it is shown only once) and paste it into the **Groq API key** field.

Notes:

- You can enter one provider key or both.
- The selected provider is used for translation and image extraction.
- Get your own key. Using someone else's key uses up their quota and, depending on their plan, may cost them money.
- Pricing, free tiers and usage limits are set by each provider and can change. Check the provider's own pages for the current terms.
- API keys are stored only in your browser's `localStorage`.
- FMlncGen has no server that receives your input or your key. The key is sent only to the API of the provider you selected (Google or Groq).
- Gemini is generally more reliable for screenshot recognition.

## Model List

- When you enter an API key, FMlncGen waits until you stop typing and then loads the text-generation models available for translation from the selected provider's model-list API. It also loads the list when you switch provider, and when the app opens with a saved key.
- **Refresh models** reloads the list by hand. Pressing it again while the list is loading does not start a second load.
- If the model you had selected is in the new list, it stays selected.
- If loading fails (wrong key, network error, no answer within 15 seconds, and so on), the previous choices and your selection stay as they were and can still be used.
- Loading the list needs a key and a network connection. If the key field is empty, nothing is sent.
- Being listed does not guarantee free quota, remaining usage or a successful translation (FMlncGen cannot see your remaining quota or limits).

## Stop, Re-run and Time Limits

- While a translation or an image extraction is running, a **Stop** button is shown. It stops waiting immediately (also during a rate-limit wait) and keeps the results so far. You can press **Parse & Translate** again right away.
- Double-clicking or repeatedly pressing **Parse & Translate** runs the translation only once.
- Image extraction also runs one at a time. Pressing the button again during an extraction does not start another one. Clearing, removing or adding images during an extraction cancels it, and its result is not added to the input (a running translation is not stopped).
- A single request that does not answer is cut off after **90 seconds** for translation and **120 seconds** for image extraction. A request that was cut off is not re-sent automatically.
- Stopping or timing out only makes the browser stop waiting. It does not guarantee that the provider stops processing, or that charges or free-quota usage are cancelled.

## Dictionary and User Dictionary

- **There is no built-in dictionary**: The built-in dictionary was retired in v2.0.0. Only words you saved to your user dictionary (including words copied into the Dictionary Manager) are translated from a dictionary; everything else goes to the AI.
- **User dictionary**: Save corrected readings from the review table with **Save edits to user dictionary**, or save all confirmed readings at once with **Add all to dictionary**. Saved words are translated without the AI from then on, so you can convert them even without an API key. The data is stored in this browser (the site data of this site).
- **Coming from an older version**: If you used an older version on the same site, the user dictionary you saved there keeps working. When older work is restored, readings created by the older version are marked **Check** and are left out of the `.lnc` until you translate them again or press **Confirm** on each row. The previous output box is not restored, and the original data is kept as a backup.
- **Download / import**: **Download dictionary** and **Import dictionary** save and load the user dictionary (source → reading) as JSON, for moving to another PC or for backups. When your dictionary is empty, the chosen file is imported as it is. When you already have a dictionary, a dialog asks how to import it ([next section](#importing-when-you-have-a-dictionary-merge-replace-cancel)).

### Importing When You Have a Dictionary (Merge, Replace, Cancel)

When you already have a dictionary and choose a file with **Import dictionary**, the **Import dictionary** dialog opens and shows how many entries your dictionary and the file have. Choose one of three ways:

| Button | Result |
|---|---|
| Merge | Adds the file to your dictionary. Words that exist in both take the reading from the file. Your other words stay. Later conversions also use the file's reading for those words (the Dictionary Manager keeps a record of the previous reading too). |
| Replace… | Deletes your dictionary and keeps only the file. You are asked once more before it happens (below). |
| Cancel | Changes nothing. |

> In a tab that was open before an update, you may get the previous version's box instead of this dialog (only **OK** and **Cancel**, where **Cancel** also replaces). Read [Before You Import a Dictionary](#before-you-import-a-dictionary-watch-out-for-the-previous-versions-box) before importing.

- Closing the dialog with `Esc` or its close button (×) also changes nothing, just like **Cancel**.
- **Replace…** opens the confirmation **Replace your dictionary?**. Only **Delete N entries and replace** replaces it. **Cancel**, `Esc` or the close button there also change nothing.
- A mouse, touch or pen press made right after one of these dialogs opens (about 0.5 seconds), or while you are still pressing in quick succession (the second half of a double click or double tap, repeated clicking), is not taken as an answer to that dialog. Pressing a key in the middle of such a press does not change that. The auto-repeat of a key held down is not an answer either. Read the dialog, then press the button again.
  - A new press of Enter or Space on the keyboard, and `Esc`, work at once.
  - The 0.5 seconds are fixed. They do not follow the double-click speed set in your operating system.
  - When assistive technology activates a button, it can be ignored right after the dialog opens, like a mouse press. Activate it again in that case.
- Replacing cannot be undone. To keep your current dictionary, cancel and save it first with **Download dictionary**.
- Only the user dictionary in this browser (what **Download dictionary** saves) is replaced. API keys, your current work and display settings do not change.
- Whenever a conversion runs, every word in the user dictionary at that moment is also copied into the [Dictionary Manager](#dictionary-manager), including words that conversion did not use. Words copied there are not deleted by a replace and may still be used in conversions after the replace.
  - Example: with Wervik and Ypres in your user dictionary, you convert only an unrelated "Zulte Town". If you then replace the dictionary with one that has only Geel, Wervik and Ypres stay in the Dictionary Manager and the next conversion still gives them the readings from before the replace.
  - Words you put into the user dictionary and never ran a conversion with have not been copied into the Dictionary Manager, so a replace does remove them.
- While a file is being read or this dialog is open, choosing another dictionary file is refused (two imports never mix). Choose it again when the first one has finished.
- A file that cannot be used (not JSON, wrong shape, no valid entries) shows an error and changes nothing.

### Dictionary Manager

The Dictionary Manager is where you search and edit saved readings.

- **Opening it**: Press **Dictionary Manager** in the **User dictionary** area. In layouts with a **Dictionary** item in the navigation or toolbar, going to the dictionary view opens the Dictionary Manager as well.
- **List**: Right after opening, recent entries are listed. Every word that was in your user dictionary when a conversion ran appears here, including words that conversion did not use (the same goes for words saved in an older version).
- **Search**: Type in the search box and press **Enter** (typing alone does not search). **Search by** offers:
  - source (prefix) — the default
  - reading (prefix) — to search by the katakana reading
  - source (exact)
  - alias
  - recent
- **Clearing**: Press **Esc** in the search box or **Clear search** to empty the search box and return to the recent list (the **Search by** choice is kept).
- **Row actions**: Detail / Lock and Unlock / Edit value / Soft delete (a deleted row can be brought back with **Revive**) / Disable.
- **Backup**: **Download Full Backup** in the Dictionary Manager saves all of the Manager's records. Taking one before large changes is a good idea.

The Dictionary Manager's own labels are shown in Japanese or English; the other UI languages use the English labels.

### About `fm_dictionary.json`

`fm_dictionary.json` is the starter dictionary that was distributed for import into older versions (v1.x).

- The current version (v2.0.0) does not load this file. It stays in the repository for compatibility with older versions.
- Importing it puts its readings into your user dictionary, where they take priority over AI readings just like readings you checked yourself. That would bring back old readings retired in v2.0.0, so normally do not import it.

## Install as a PWA and Offline Use

When FMlncGen is opened from a hosted site such as GitHub Pages, supported browsers can install it as a standalone desktop-style application from the install icon in the address bar.

- **The first visit needs a network connection**: The files needed offline are prepared when you first open the app.
- **Available offline**: Once the app has been opened online and prepared (installed or not), the following work offline:
  - converting with your user dictionary, and generating and saving `.lnc`
  - the Dictionary Manager (search and edit)
  - choosing and switching UI layouts and colour themes
- **Needs a network connection**: AI translation, image extraction and loading the model list (all of them also need an API key).

### After an Update

- Right after a new version is published, the first screen you open may still be the previous version. Reload the page. One reload does not always switch it. If it does not, wait a moment and reload again, or close every tab and window of FMlncGen (including the installed app) and open it again.
- A tab that was already open before the update keeps running the previous version until you reload it.
- **What a reload loses**: your work is saved when you convert (**Parse & Translate**), correct something in the review table, or generate or load a `.lnc`. A reading you retype in the table is not saved at once: it is saved shortly (about 0.8 seconds) after your last keystroke, so reloading right after retyping can lose that correction. Text you put into the input box after a save, and hand edits in the output box, are lost when you reload. Converted results, table corrections that were saved and the generated `.lnc` come back. Reload at a natural break in your work, and before reloading copy any source text or hand edits you want to keep into a text editor or similar and save them there.
- The version shown in the app stays v2.0.0, and the layout icon button (**Choose UI layout**) was already there in the previous version, so neither tells you whether you have the new version.
- You do not need to delete browser data (site data or caches) to update. Deleting site data also deletes your user dictionary, your work, your API keys and your display settings.

#### Before You Import a Dictionary (Watch Out for the Previous Version's Box)

In the versions published up to 2026-10-08, importing while you already have a dictionary shows the browser's own confirmation box (just two buttons, **OK** and **Cancel**). In that box **OK** merges and **Cancel replaces** (deletes your dictionary and keeps only the file). Both buttons change your dictionary; there is no button that stops the import. The new version shows a dialog with three buttons instead, **Merge**, **Replace…** and **Cancel**, where **Cancel** changes nothing ([Importing When You Have a Dictionary](#importing-when-you-have-a-dictionary-merge-replace-cancel)).

- In a tab that was open before the update, reload the page before importing (mind "What a reload loses" above).
- One reload does not always bring the new version. Before importing, you can keep a copy of your current user dictionary by saving it with **Download dictionary** (downloading does not change your dictionary).
- If importing shows a box with only **OK** and **Cancel**, it is the previous version. **Cancel** there does not stop the import; it replaces your dictionary.
- When your dictionary is empty, both versions import the file straight away without asking.

## File Structure

The app itself is these 26 files:

| File | Purpose |
|---|---|
| `index.html` | Main application (screens, the seven layouts, translation and `.lnc` generation) |
| `sw.js` | Offline support and update handling |
| `manifest.json` | PWA metadata |
| `icon-192.png` / `icon-512.png` | Application icons |
| `.nojekyll` | GitHub Pages setting |
| 6 JavaScript files in `assets/build-35096d1b0de6/` | Dictionary engine (conversion and dictionary lookup), the Dictionary Manager, AI translation working with the dictionary, and their shared parts |
| 14 images in `assets/build-35096d1b0de6/` | Thumbnails for the layout chooser (7 layouts × light / dark) |

The folder name under `assets/` changes with each build.

The repository also holds these 11 files (37 files in total). The current app loads none of them.

| File | Purpose |
|---|---|
| `README.md` / `README_EN.md` / `CHANGELOG.md` | Documentation and change history |
| `country-example.png` | Image used in this README |
| `fm_dictionary.json` | Starter dictionary for older versions (see [above](#about-fm_dictionaryjson)) |
| 6 JavaScript files in `assets/build-aa5bb44e3eb4/` | Files used by a previous version |

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
- Generated `.lnc` files are placed in the Football Manager `…/Shared/Database/DB/<version>/LNC/All` folder (`<version>` is the folder for the Football Manager version you use; pick a number that actually exists in the DB folder). A `.lnc` with the same name is overwritten, so keep a copy first if you need it.
- Player-name changes apply globally because Football Manager does not separate them by language.
- Stadium-name changes may not work for every target or every Football Manager version.

## Input Validation, Line Endings, and Error Logs

- Lines without a valid numeric ID at the end are reported as unreadable and skipped.
- Duplicate IDs are reported before generation.
- Saved and copied `.lnc` output uses **CRLF (`\r\n`)** line endings, UTF-8, without BOM.
- Characters that could break `.lnc` syntax are removed during generation.
- Rows whose AI translation failed and rows marked **Check** are left out of the `.lnc`. Enter a reading or translate them again.
- Error logs can be saved as `.log` files from the **Error log** button for bug reports.

## Features

- Club / Competition / Player / Stadium modes
- Gemini / Groq provider switching
- Automatic model discovery with a **Refresh models** button (see [Model List](#model-list))
- Seven UI layouts and an Auto / Light / Dark colour theme (see [UI Layouts and Colour Theme](#ui-layouts-and-colour-theme))
- Batch translation (15 / 20 / 10 / 1 items per request); missed items are retried one by one
- Dictionary-only translation (no API key needed when no row has to go to the AI)
- Automatic duplicate reuse
- Automatic work save/restore (start over with **Clear**)
- Stop translation/extraction (see [Stop, Re-run and Time Limits](#stop-re-run-and-time-limits))
- Add all results to the user dictionary
- Dictionary Manager for searching, editing, locking and backing up readings (see [Dictionary Manager](#dictionary-manager))
- Import existing `.lnc` files
- Show only items requiring attention

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
