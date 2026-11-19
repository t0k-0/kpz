# KPZ worksheets

Put class worksheets in this folder. PDF, PNG, JPG, SVG and other files that browsers can open work well.

To show a file in the KPZ gallery, add an object to `index.json`:

```json
{
  "title": "Worksheet title",
  "description": "A short description for classmates.",
  "category": "Biology",
  "file": "worksheet.pdf",
  "thumbnail": "worksheet-preview.jpg"
}
```

`thumbnail` is optional. Paths are relative to this folder. Keep file names lowercase and use hyphens instead of spaces.
