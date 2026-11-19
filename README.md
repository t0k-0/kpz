# KPZ

KPZ is a phone-first study web app for a class. A single SQL-like study-set file powers four modes: flashcards, typed learning, multiple-choice quizzes and a memory matching game. It also includes a worksheet gallery and a browser-based admin content editor.

## Run locally

The app loads data files with `fetch`, so open it through a local web server rather than double-clicking `index.html`.

```powershell
npx serve .
```

Then open the local URL printed in the terminal.

Default access codes:

- Student: `kpz2026`
- Admin: `kpz-admin`

Change both before sharing the site. See “Access codes” below.

Useful repository commands:

```powershell
npm run check       # validate configuration, study sets and worksheets
npm run build       # create the exact deployable site in _site/
npm run test:browser
```

The app has no runtime packages to install. Node.js 20 or newer is only used for validation and building the deployment artifact.

## Add a study set

Copy one of the files in `data/sets/`, or make a new `.sql` file using this structure:

```sql
-- id: chemistry-atoms
-- title: Atoms & elements
-- subject: Chemistry
-- description: The essential vocabulary for this chapter.
-- color: violet

INSERT INTO cards (term, definition, hint, image) VALUES
  ('Atom', 'The smallest particle of an element.', NULL, NULL),
  ('Element', 'A pure substance made from one type of atom.', NULL, NULL);
```

Allowed colours are `violet`, `coral`, `mint`, `blue` and `yellow`. Escape an apostrophe inside a value by doubling it: `('student''s', 'belonging to a student', NULL, NULL)`.

Add the file to `data/sets/index.json`:

```json
{ "id": "chemistry-atoms", "file": "chemistry-atoms.sql" }
```

The Admin page can build the file for you. It stores drafts only in the current browser and has separate buttons for downloading the `.sql` file and an updated `index.json`. Put those downloads in `data/sets/`, commit and push them to publish the update.

## Add worksheets

Place worksheet files in `worksheets/` and add their details to `worksheets/index.json`. See `worksheets/README.md` for the exact format. PDFs, images and other browser-readable documents can be opened or downloaded from the gallery.

## Access codes

GitHub Pages is static hosting. KPZ's password screen is a convenient class gate, not strong security: the browser receives the password hashes and every published file remains technically accessible by URL. Do not store private, sensitive or copyrighted material that must be access-controlled.

To change a code, generate its SHA-256 hash:

```powershell
$value = "your-new-code"
$bytes = [Text.Encoding]::UTF8.GetBytes($value)
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
[BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()
```

Replace `studentHash` or `adminHash` in `data/config.json` with the result. For real user accounts, private files and direct online admin saving, use a server-backed platform such as Cloudflare Pages/Workers, Firebase or Supabase instead of GitHub Pages.

## Publish on GitHub Pages

This repository includes automated validation, a clean static build, dependency updates and GitHub Pages deployment.

1. Create an empty GitHub repository. Do not add another README, `.gitignore` or license during creation.
2. Connect this local repository and push it:

   ```powershell
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

3. On GitHub, open **Settings → Pages** and select **GitHub Actions** under **Build and deployment** if it is not already selected.
4. Open the **Actions** tab. The `Deploy KPZ to GitHub Pages` workflow validates the content, builds `_site/` and publishes it.
5. The deployment summary displays the final site URL. Every later push to `main` republishes automatically.

Your URL will normally be `https://YOUR-NAME.github.io/REPOSITORY/`. The app uses relative paths, so project pages work without configuration.

Pull requests and non-`main` branches run the separate `Check KPZ` workflow without publishing. Dependabot checks the GitHub Actions versions monthly.

For a custom domain, configure it under **Settings → Pages → Custom domain** after the first successful deployment. GitHub will manage the corresponding `CNAME` setting; do not add a placeholder domain to this repository.

## Data and privacy

Study progress, login state and admin drafts stay in each user's browser through `localStorage`/`sessionStorage`; there is no analytics or server database. Clearing site storage removes that local data. The service worker caches recently loaded content for offline study after the first visit.
