# Pracovní listy KPZ

Do této složky ukládej PDF, Word dokumenty a další materiály pro galerii pracovních listů.

Soubor `index.json` musí ve složce zůstat. Pro každý nový dokument do pole `worksheets` přidej záznam:

```json
{
  "title": "Název pracovního listu",
  "description": "Krátký popis pro ostatní.",
  "category": "Biologie",
  "file": "pracovni-list.pdf"
}
```

Název v poli `file` se musí přesně shodovat s názvem dokumentu. Používej malá písmena bez mezer a diakritiky.
