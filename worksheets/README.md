# Pracovní listy KPZ

Do této složky ukládej PDF, Word dokumenty a další materiály pro galerii pracovních listů.

Soubor `index.json` musí ve složce zůstat. Pro každý nový dokument do pole `worksheets` přidej záznam:

```json
{
  "title": "Název pracovního listu",
  "description": "Krátký popis pro ostatní.",
  "category": "Biologie",
  "added": "2026-11-19",
  "file": "pracovni-list.pdf"
}
```

Pole `added` obsahuje datum přidání ve formátu `RRRR-MM-DD`. Galerie podle něj seskupuje dokumenty a zobrazuje nejnovější nahoře. Název v poli `file` se musí přesně shodovat s názvem dokumentu. Používej malá písmena bez mezer a diakritiky.
