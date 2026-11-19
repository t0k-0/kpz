# Pracovní listy KPZ

Do této složky ukládej společné pracovní listy. Dobře fungují soubory PDF, PNG, JPG, SVG a další formáty, které umí otevřít prohlížeč.

Pokud chceš soubor zobrazit v galerii KPZ, přidej objekt do `index.json`:

```json
{
  "title": "Název pracovního listu",
  "description": "Krátký popis pro ostatní.",
  "category": "Biologie",
  "file": "pracovni-list.pdf",
  "thumbnail": "nahled-pracovniho-listu.jpg"
}
```

Položka `thumbnail` je volitelná. Cesty jsou relativní k této složce. Názvy souborů piš malými písmeny a místo mezer používej pomlčky.
