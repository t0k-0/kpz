# Slepá mapa KPZ

`world-assignment.json` obsahuje názvy a cílové oblasti pro trenažér slepé mapy. Každá položka má kategorii a jednu nebo více geometrií:

- `point`: bod `[zeměpisná délka, zeměpisná šířka]` s tolerancí `radiusKm`
- `line`: řada bodů s tolerancí `radiusKm`
- `polygon`: uzavřená oblast

Trenažér přidává k uložené toleranci malou rezervu pro nepřesný dotyk na telefonu. Řeky jsou v publikovaných datech uložené jako přibližné linie, ne jako jednotlivé body.

Admin editor umí položky a geometrie upravit a stáhnout nový JSON. Protože GitHub Pages nemůže zapisovat přímo do repozitáře, staženým souborem je potřeba nahradit `world-assignment.json` a změnu odeslat přes GitHub Desktop.

Mapa načítá podrobnější pobřeží Natural Earth v měřítku 1:50m z pevně určené revize oficiálního repozitáře. Pokud externí soubor není dostupný, použije místní `ne_110m_land.geojson`. Data Natural Earth jsou public domain: https://www.naturalearthdata.com/about/terms-of-use/
